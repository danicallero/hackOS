import type { Queryable } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { BadRequestError, NotFoundError } from "../../lib/errors.js";
import {
  assertFixtureSubjectScope,
  isSyntheticOperator,
} from "../logistics/review-fixture-scope.js";
import { type NotificationChannel, notify } from "./service.js";
import type { Language } from "./translate/index.js";

/**
 * H50 announcements: publish_at + expires_at is the vigencia window
 * ("aparece y desaparece solo"). DELTA(H50): expires_at + fanned_out_at are
 * new columns from migration 0600 — the boceto only had a start, and nothing
 * tracked whether the per-user fan-out had already run for a given row.
 *
 * DELTA(H50, 0722): audience/recipient targeting and a per-announcement
 * channel candidate set. `audiences` (sponsor/participant/mentor, reusing
 * H59's vocabulary) and explicit `recipientUserIds` are mutually exclusive —
 * a non-empty recipient list wins if both are ever present, but the API
 * layer rejects that combination outright (assertTargetingExclusivity).
 * Empty audiences AND no recipients means "everyone", unchanged from before.
 */

export const ANNOUNCEMENT_AUDIENCES = ["sponsor", "participant", "mentor", "staff"] as const;
export type AnnouncementAudience = (typeof ANNOUNCEMENT_AUDIENCES)[number];

export interface AnnouncementInput {
  title: string;
  body: string;
  translations: AnnouncementTranslations;
  notifyUsers: boolean;
  screenPlacement: ScreenPlacement;
  publishAt: string | null;
  expiresAt: string | null;
  audiences: AnnouncementAudience[];
  channels: NotificationChannel[];
  recipientUserIds: number[];
}

export const SCREEN_PLACEMENTS = ["none", "embedded", "fullscreen"] as const;
export type ScreenPlacement = (typeof SCREEN_PLACEMENTS)[number];
export type AnnouncementLanguage = Language;
export type AnnouncementTranslation = { title: string; body: string };
export type AnnouncementTranslations = Partial<
  Record<AnnouncementLanguage, AnnouncementTranslation>
>;

const ANNOUNCEMENT_LANGUAGES: AnnouncementLanguage[] = ["es", "gl", "en"];

function isCompleteTranslation(
  value: AnnouncementTranslation | undefined,
): value is AnnouncementTranslation {
  return Boolean(value?.title.trim() && value.body.trim());
}

/**
 * Keep the canonical fields aligned with the first complete translation. An
 * announcement may intentionally contain just one language; those canonical
 * fields are the final fallback for every recipient (H50).
 */
export function normalizeAnnouncementContent(input: {
  title: string;
  body: string;
  translations: AnnouncementTranslations;
}): Pick<AnnouncementInput, "title" | "body" | "translations"> {
  const translations = Object.fromEntries(
    ANNOUNCEMENT_LANGUAGES.flatMap((language) => {
      const value = input.translations[language];
      return isCompleteTranslation(value)
        ? [[language, { title: value.title.trim(), body: value.body.trim() }]]
        : [];
    }),
  ) as AnnouncementTranslations;
  const primary = ANNOUNCEMENT_LANGUAGES.map((language) => translations[language]).find(
    isCompleteTranslation,
  );
  return {
    title: primary?.title ?? input.title.trim(),
    body: primary?.body ?? input.body.trim(),
    translations,
  };
}

export interface Announcement {
  id: number;
  author_id: number | null;
  title: string;
  body: string;
  translations: AnnouncementTranslations;
  notify_users: boolean;
  screen_placement: ScreenPlacement;
  publish_at: string | null;
  expires_at: string | null;
  fanned_out_at: string | null;
  audiences: AnnouncementAudience[];
  channels: NotificationChannel[];
  created_at: string;
}

export interface PublicAnnouncement {
  id: number;
  title: string;
  body: string;
  translations: AnnouncementTranslations;
  publishAt: string | null;
  expiresAt: string | null;
  screenPlacement: ScreenPlacement;
}

function assertVisibilityWindow(
  screenPlacement: ScreenPlacement,
  notifyUsers: boolean,
  publishAt: string | null,
  expiresAt: string | null,
): void {
  if (publishAt && expiresAt && new Date(expiresAt).getTime() <= new Date(publishAt).getTime()) {
    throw new BadRequestError("An announcement must expire after it becomes visible");
  }
  if (screenPlacement === "none" && notifyUsers && expiresAt) {
    throw new BadRequestError(
      "A notify-only announcement (no screen placement) fires once at publish time and can't have an end date",
    );
  }
}

/** Audience-tag broadcast and an explicit recipient list are mutually exclusive targeting modes. */
function assertTargetingExclusivity(
  screenPlacement: ScreenPlacement,
  audiences: AnnouncementAudience[],
  recipientUserIds: number[],
): void {
  if (audiences.length > 0 && recipientUserIds.length > 0) {
    throw new BadRequestError(
      "Choose either an audience or specific recipients for an announcement, not both",
    );
  }
  if (screenPlacement !== "none" && recipientUserIds.length > 0) {
    throw new BadRequestError(
      "A screen-placed announcement can't be targeted to specific recipients — the TV feed is anonymous",
    );
  }
}

async function announcementFixtureMarker(
  db: Queryable,
  authorId: number | null | undefined,
  announcementId?: number,
): Promise<boolean> {
  if (authorId != null && (await isSyntheticOperator(db, authorId))) return true;
  if (announcementId == null) return false;
  const { rows } = await db.query(
    `SELECT 1
       FROM audit_log
      WHERE entity_type = 'announcement'
        AND entity_id = $1::text
        AND action = 'fixture_scope_marked'
        AND after ->> 'is_test_account' = 'true'
      LIMIT 1`,
    [announcementId],
  );
  return rows.length > 0;
}

/**
 * The author foreign key is intentionally detached during account removal.
 * Keep the fixture boundary in an identity-free audit marker so a synthetic
 * announcement cannot become a normal public/admin announcement after its
 * author is scrubbed.
 */
async function markAnnouncementFixture(
  db: Queryable,
  announcementId: number,
  fixtureMarker: boolean,
): Promise<void> {
  if (!fixtureMarker) return;
  const { rows } = await db.query(
    `SELECT 1
       FROM audit_log
      WHERE entity_type = 'announcement'
        AND entity_id = $1::text
        AND action = 'fixture_scope_marked'
      LIMIT 1`,
    [announcementId],
  );
  if (rows[0]) return;
  await audit(db, {
    actorId: null,
    entityType: "announcement",
    entityId: announcementId,
    action: "fixture_scope_marked",
    source: "system",
    after: { is_test_account: true },
    ip: null,
    userAgent: null,
  });
}

function announcementFixtureMarkerSql(announcementAlias = "a", authorAlias = "author"): string {
  return `(COALESCE(${authorAlias}.is_test_account, false)
    OR EXISTS (
      SELECT 1
        FROM audit_log fixture_marker
       WHERE fixture_marker.entity_type = 'announcement'
         AND fixture_marker.entity_id = ${announcementAlias}.id::text
         AND fixture_marker.action = 'fixture_scope_marked'
         AND fixture_marker.after ->> 'is_test_account' = 'true'
    ))`;
}

async function replaceAnnouncementRecipients(
  db: Queryable,
  announcementId: number,
  recipientUserIds: number[],
  fixtureMarker: boolean,
  actorId?: number,
): Promise<void> {
  const ids = [...new Set(recipientUserIds)];
  if (ids.length > 0) {
    const { rows } = await db.query<{ id: number; is_test_account: boolean }>(
      `SELECT id, is_test_account
         FROM users
        WHERE id = ANY($1::int[])
          AND account_state = 'active' AND anonymized_at IS NULL
        ORDER BY id
        FOR SHARE`,
      [ids],
    );
    if (rows.length !== ids.length) throw new NotFoundError("Recipient user not found");
    for (const row of rows) {
      if (actorId != null) await assertFixtureSubjectScope(db, actorId, Number(row.id));
      if (row.is_test_account !== fixtureMarker) {
        throw new NotFoundError("Recipient user not found");
      }
    }
  }
  await db.query(`DELETE FROM announcement_recipients WHERE announcement_id = $1`, [
    announcementId,
  ]);
  if (ids.length === 0) return;
  await db.query(
    `INSERT INTO announcement_recipients (announcement_id, user_id)
     SELECT $1, unnest($2::int[])`,
    [announcementId, ids],
  );
}

export async function getAnnouncementRecipientIds(
  db: Queryable,
  announcementId: number,
): Promise<number[]> {
  const { rows } = await db.query(
    `SELECT user_id FROM announcement_recipients WHERE announcement_id = $1 ORDER BY user_id`,
    [announcementId],
  );
  return rows.map((r) => Number((r as { user_id: number }).user_id));
}

export interface AnnouncementRecipient {
  id: number;
  name: string | null;
  surname: string | null;
  email: string;
}

/** Display-friendly recipient list for the admin edit UI (id-only version above drives targeting logic). */
export async function getAnnouncementRecipients(
  db: Queryable,
  announcementId: number,
): Promise<AnnouncementRecipient[]> {
  const fixtureMarkerSql = announcementFixtureMarkerSql();
  const { rows } = await db.query(
    `SELECT u.id, u.name, u.surname, u.email
     FROM announcement_recipients ar
     JOIN users u ON u.id = ar.user_id
     JOIN announcements a ON a.id = ar.announcement_id
     LEFT JOIN users author ON author.id = a.author_id
     WHERE ar.announcement_id = $1
       AND u.account_state = 'active'
       AND u.anonymized_at IS NULL
       AND u.is_test_account = ${fixtureMarkerSql}
     ORDER BY u.id`,
    [announcementId],
  );
  return rows as AnnouncementRecipient[];
}

/** Minimal account identity fields for an ANNOUNCEMENTS_MANAGE holder picking specific recipients — deliberately not gated by the broader USERS_READ (mirrors listScheduleOwnerCandidates). */
export async function listAnnouncementRecipientCandidates(
  db: Queryable,
  query: string,
  limit: number,
  actorId?: number,
): Promise<AnnouncementRecipient[]> {
  const filter = `%${query.trim()}%`;
  const fixtureMarker = actorId == null ? false : await isSyntheticOperator(db, actorId);
  const { rows } = await db.query(
    `SELECT id, email, name, surname
       FROM users
      WHERE account_state = 'active' AND anonymized_at IS NULL
        AND is_test_account = $3
        AND (email ILIKE $1 OR name ILIKE $1 OR surname ILIKE $1)
      ORDER BY name ASC NULLS LAST, surname ASC NULLS LAST, email ASC
      LIMIT $2`,
    [filter, limit, fixtureMarker],
  );
  return rows as AnnouncementRecipient[];
}

export async function createAnnouncement(
  db: Queryable,
  authorId: number,
  input: AnnouncementInput,
  actorId: number = authorId,
): Promise<Announcement> {
  const author = await db.query<{ id: number; is_test_account: boolean }>(
    `SELECT id, is_test_account FROM users
      WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL
      FOR SHARE`,
    [authorId],
  );
  if (!author.rows[0]) throw new NotFoundError("User not found");
  await assertFixtureSubjectScope(db, actorId, authorId);
  const fixtureMarker = author.rows[0].is_test_account === true;
  const content = normalizeAnnouncementContent(input);
  assertVisibilityWindow(
    input.screenPlacement,
    input.notifyUsers,
    input.publishAt,
    input.expiresAt,
  );
  assertTargetingExclusivity(input.screenPlacement, input.audiences, input.recipientUserIds);
  const { rows } = await db.query(
    `INSERT INTO announcements
       (author_id, title, body, translations, notify_users, screen_placement, publish_at, expires_at, audiences, channels)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      authorId,
      content.title,
      content.body,
      JSON.stringify(content.translations),
      input.notifyUsers,
      input.screenPlacement,
      input.publishAt,
      input.expiresAt,
      input.audiences,
      input.channels,
    ],
  );
  const created = rows[0];
  await markAnnouncementFixture(db, created.id, fixtureMarker);
  await replaceAnnouncementRecipients(
    db,
    created.id,
    input.recipientUserIds,
    fixtureMarker,
    actorId,
  );
  return created;
}

export async function updateAnnouncement(
  db: Queryable,
  id: number,
  input: Partial<AnnouncementInput>,
  actorId?: number,
): Promise<Announcement> {
  const existing = await getAnnouncement(db, id, actorId);
  const fixtureMarker = await announcementFixtureMarker(db, existing.author_id, existing.id);
  const existingRecipientIds =
    input.recipientUserIds !== undefined
      ? input.recipientUserIds
      : await getAnnouncementRecipientIds(db, id);
  const content =
    input.translations !== undefined
      ? normalizeAnnouncementContent({
          title: input.title ?? existing.title,
          body: input.body ?? existing.body,
          translations: input.translations,
        })
      : {
          title: (input.title ?? existing.title).trim(),
          body: (input.body ?? existing.body).trim(),
          translations: existing.translations,
        };
  const merged = {
    ...content,
    notifyUsers: input.notifyUsers ?? existing.notify_users,
    screenPlacement: input.screenPlacement ?? existing.screen_placement,
    publishAt: input.publishAt !== undefined ? input.publishAt : existing.publish_at,
    expiresAt: input.expiresAt !== undefined ? input.expiresAt : existing.expires_at,
    audiences: input.audiences ?? existing.audiences,
    channels: input.channels ?? existing.channels,
    recipientUserIds: existingRecipientIds,
  };
  assertVisibilityWindow(
    merged.screenPlacement,
    merged.notifyUsers,
    merged.publishAt,
    merged.expiresAt,
  );
  assertTargetingExclusivity(merged.screenPlacement, merged.audiences, merged.recipientUserIds);
  const { rows } = await db.query(
    `UPDATE announcements
     SET title = $2, body = $3, translations = $4::jsonb, notify_users = $5,
         screen_placement = $6, publish_at = $7, expires_at = $8, audiences = $9, channels = $10
     WHERE id = $1
     RETURNING *`,
    [
      id,
      merged.title,
      merged.body,
      JSON.stringify(merged.translations),
      merged.notifyUsers,
      merged.screenPlacement,
      merged.publishAt,
      merged.expiresAt,
      merged.audiences,
      merged.channels,
    ],
  );
  const updated = rows[0];
  if (!updated) throw new NotFoundError("Announcement not found");
  if (input.recipientUserIds !== undefined) {
    await replaceAnnouncementRecipients(db, id, input.recipientUserIds, fixtureMarker, actorId);
  }
  return updated;
}

export async function deleteAnnouncement(
  db: Queryable,
  id: number,
  actorId?: number,
): Promise<Announcement> {
  if (actorId != null) await getAnnouncement(db, id, actorId);
  const { rows } = await db.query(`DELETE FROM announcements WHERE id = $1 RETURNING *`, [id]);
  if (!rows[0]) throw new NotFoundError("Announcement not found");
  return rows[0];
}

export async function getAnnouncement(
  db: Queryable,
  id: number,
  actorId?: number,
): Promise<Announcement> {
  const params: unknown[] = [id];
  const fixtureMarkerSql = announcementFixtureMarkerSql();
  const markerClause = actorId == null ? "" : ` AND ${fixtureMarkerSql} = $2`;
  if (actorId != null) params.push(await isSyntheticOperator(db, actorId));
  const { rows } = await db.query(
    `SELECT a.* FROM announcements a
       LEFT JOIN users author ON author.id = a.author_id
      WHERE a.id = $1${markerClause}`,
    params,
  );
  if (!rows[0]) throw new NotFoundError("Announcement not found");
  return rows[0];
}

export async function listAnnouncementsAdmin(
  db: Queryable,
  actorId?: number,
): Promise<Announcement[]> {
  const fixtureMarkerSql = announcementFixtureMarkerSql();
  const markerClause = actorId == null ? "" : ` WHERE ${fixtureMarkerSql} = $1`;
  const params = actorId == null ? [] : [await isSyntheticOperator(db, actorId)];
  const { rows } = await db.query(
    `SELECT a.* FROM announcements a
       LEFT JOIN users author ON author.id = a.author_id
      ${markerClause}
      ORDER BY a.created_at DESC`,
    params,
  );
  return rows;
}

/** Public feed (H49/H50): only announcements currently inside their vigencia window. */
export async function listAnnouncementsPublic(db: Queryable): Promise<PublicAnnouncement[]> {
  const fixtureMarkerSql = announcementFixtureMarkerSql();
  const { rows } = await db.query(
    `SELECT a.id, a.title, a.body, a.translations, a.publish_at, a.expires_at, a.screen_placement FROM announcements a
     LEFT JOIN users author ON author.id = a.author_id
     WHERE NOT ${fixtureMarkerSql}
       AND (a.publish_at IS NULL OR a.publish_at <= now())
       AND (a.expires_at IS NULL OR a.expires_at > now())
     ORDER BY a.publish_at DESC NULLS LAST, a.created_at DESC`,
  );
  return rows.map((row) => ({
    id: Number(row.id),
    title: String(row.title),
    body: String(row.body),
    translations: (row.translations as AnnouncementTranslations) ?? {},
    publishAt: row.publish_at ? new Date(row.publish_at as Date).toISOString() : null,
    expiresAt: row.expires_at ? new Date(row.expires_at as Date).toISOString() : null,
    screenPlacement: row.screen_placement as ScreenPlacement,
  }));
}

export async function markAnnouncementRead(
  db: Queryable,
  userId: number,
  announcementId: number,
): Promise<void> {
  await getAnnouncement(db, announcementId, userId); // 404s if missing or cross-fixture
  const { rows: users } = await db.query(
    `SELECT id FROM users
      WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL
      FOR SHARE`,
    [userId],
  );
  if (!users[0]) throw new NotFoundError("User not found");
  await db.query(
    `INSERT INTO announcement_reads (announcement_id, user_id) VALUES ($1, $2)
     ON CONFLICT (announcement_id, user_id) DO NOTHING`,
    [announcementId, userId],
  );
}

/**
 * Resolves who an announcement reaches: an explicit recipient list wins if
 * set; otherwise audience tags (sponsor/participant/mentor, same vocabulary
 * and "sponsor implies participant" rule as H59's schedule audiences — see
 * identity/role.ts's mentorOrParticipantType/computeMembershipFlags, whose
 * bulk-query equivalent (user_effective_badge_category) is joined directly
 * here to avoid an N+1 per user); otherwise everyone, unchanged from before
 * this feature existed.
 */
async function resolveRecipients(
  db: Queryable,
  announcement: Pick<Announcement, "id" | "audiences" | "author_id">,
): Promise<Array<{ id: number; language: string | null }>> {
  const fixtureMarker = await announcementFixtureMarker(
    db,
    announcement.author_id,
    announcement.id,
  );
  const targeted = await getAnnouncementRecipientIds(db, announcement.id);
  if (targeted.length > 0) {
    const { rows } = await db.query(
      `SELECT id, language FROM users
        WHERE id = ANY($1::int[])
          AND account_state = 'active' AND anonymized_at IS NULL
          AND is_test_account = $2`,
      [targeted, fixtureMarker],
    );
    return rows as Array<{ id: number; language: string | null }>;
  }

  if (announcement.audiences.length === 0) {
    const { rows } = await db.query(
      `SELECT id, language FROM users
        WHERE account_state = 'active' AND anonymized_at IS NULL
          AND is_test_account = $1`,
      [fixtureMarker],
    );
    return rows as Array<{ id: number; language: string | null }>;
  }

  const { rows } = await db.query(
    `WITH staff AS (
       -- Same "holds at least one capability" definition as
       -- getEffectiveCapabilities/getBadgeCategory's staff bucket.
       SELECT DISTINCT user_id FROM user_effective_capabilities
     ),
     attendee AS (
       SELECT user_id, badge_category::text AS type
       FROM user_effective_badge_category
       WHERE badge_category IN ('mentor', 'participant')
     ),
     sponsor AS (
       SELECT DISTINCT user_id FROM sponsors WHERE user_id IS NOT NULL
     )
     SELECT u.id, u.language
     FROM users u
     LEFT JOIN attendee at ON at.user_id = u.id
     LEFT JOIN sponsor sp ON sp.user_id = u.id
     LEFT JOIN staff st ON st.user_id = u.id
     WHERE u.account_state = 'active' AND u.anonymized_at IS NULL
       AND u.is_test_account = $2
       AND (at.type = ANY($1::text[])
        OR (sp.user_id IS NOT NULL AND ($1::text[] && ARRAY['sponsor', 'participant']::text[]))
        OR (st.user_id IS NOT NULL AND 'staff' = ANY($1::text[])))`,
    [announcement.audiences, fixtureMarker],
  );
  return rows as Array<{ id: number; language: string | null }>;
}

function translatedContent(
  announcement: Announcement,
  language: string | null,
): AnnouncementTranslation {
  const translations = announcement.translations ?? {};
  const preferred = language === "es" || language === "gl" || language === "en" ? language : "es";
  return (
    translations[preferred] ??
    translations.es ??
    translations.gl ??
    translations.en ?? { title: announcement.title, body: announcement.body }
  );
}

/**
 * Fans out this announcement's chosen channels (each still filtered through
 * the recipient's own H51 preferences) to its resolved recipients, then
 * marks it as fanned out so a later poll of the visibility publisher doesn't
 * repeat it. NOT idempotent by itself — it always re-sends, so callers must
 * gate on fanned_out_at IS NULL (fanOutIfVisibleNow below, and the
 * publisher's claim query in announcements-publisher.ts both do).
 *
 * This already gives the "notify once at publish time" behavior for a
 * screen+notify announcement too: the window (publish_at/expires_at) governs
 * whether the row is on-screen, but the notify fan-out is a one-shot side
 * effect of becoming visible, not something repeated for the window's
 * duration — fanned_out_at prevents any repeat even though the row stays
 * visible/pollable for the rest of its window. No special-casing needed here
 * for the notify-only vs. screen-placed distinction.
 *
 * Mutates `announcement.fanned_out_at` so callers holding the row object
 * (e.g. the create route returning it as the response body) see the marker
 * without a re-read.
 */
export async function fanOutAnnouncement(db: Queryable, announcement: Announcement): Promise<void> {
  if (!announcement.notify_users) return;
  const fixtureMarker = await announcementFixtureMarker(
    db,
    announcement.author_id,
    announcement.id,
  );
  const recipients = await resolveRecipients(db, announcement);
  for (const recipient of recipients) {
    const content = translatedContent(announcement, recipient.language);
    await notify(db, {
      userId: recipient.id,
      category: "announcements",
      channels: announcement.channels,
      fixtureMarker,
      payload: {
        template: "generic",
        subject: content.title,
        body: content.body,
        vars: { announcementId: announcement.id },
      },
    });
  }
  const { rows } = await db.query(
    `UPDATE announcements SET fanned_out_at = now() WHERE id = $1 RETURNING fanned_out_at`,
    [announcement.id],
  );
  announcement.fanned_out_at = rows[0].fanned_out_at;
}

/** Currently-visible now AND not yet fanned out — used both at create-time (immediate visibility) and by the publisher poll (timed reveal). */
export function isCurrentlyVisible(a: Pick<Announcement, "publish_at" | "expires_at">): boolean {
  const now = Date.now();
  const publishOk = !a.publish_at || new Date(a.publish_at).getTime() <= now;
  const expiryOk = !a.expires_at || new Date(a.expires_at).getTime() > now;
  return publishOk && expiryOk;
}

/** Called right after create/update: fans out immediately if the row is visible right now and hasn't been fanned out yet. */
export async function fanOutIfVisibleNow(db: Queryable, announcement: Announcement): Promise<void> {
  if (!announcement.notify_users) return;
  if (announcement.fanned_out_at) return;
  if (isCurrentlyVisible(announcement)) {
    await fanOutAnnouncement(db, announcement);
  }
}
