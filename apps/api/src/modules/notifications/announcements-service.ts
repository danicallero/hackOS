import type { Queryable } from "../../db/pool.js";
import { BadRequestError, NotFoundError } from "../../lib/errors.js";
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

export interface Announcement {
  id: number;
  author_id: number;
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

async function replaceAnnouncementRecipients(
  db: Queryable,
  announcementId: number,
  recipientUserIds: number[],
): Promise<void> {
  await db.query(`DELETE FROM announcement_recipients WHERE announcement_id = $1`, [
    announcementId,
  ]);
  if (recipientUserIds.length === 0) return;
  await db.query(
    `INSERT INTO announcement_recipients (announcement_id, user_id)
     SELECT $1, unnest($2::int[])`,
    [announcementId, recipientUserIds],
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
  const { rows } = await db.query(
    `SELECT u.id, u.name, u.surname, u.email
     FROM announcement_recipients ar
     JOIN users u ON u.id = ar.user_id
     WHERE ar.announcement_id = $1
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
): Promise<AnnouncementRecipient[]> {
  const filter = `%${query.trim()}%`;
  const { rows } = await db.query(
    `SELECT id, email, name, surname
       FROM users
      WHERE anonymized_at IS NULL
        AND (email ILIKE $1 OR name ILIKE $1 OR surname ILIKE $1)
      ORDER BY name ASC NULLS LAST, surname ASC NULLS LAST, email ASC
      LIMIT $2`,
    [filter, limit],
  );
  return rows as AnnouncementRecipient[];
}

export async function createAnnouncement(
  db: Queryable,
  authorId: number,
  input: AnnouncementInput,
): Promise<Announcement> {
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
      input.title,
      input.body,
      JSON.stringify(input.translations),
      input.notifyUsers,
      input.screenPlacement,
      input.publishAt,
      input.expiresAt,
      input.audiences,
      input.channels,
    ],
  );
  const created = rows[0];
  await replaceAnnouncementRecipients(db, created.id, input.recipientUserIds);
  return created;
}

export async function updateAnnouncement(
  db: Queryable,
  id: number,
  input: Partial<AnnouncementInput>,
): Promise<Announcement> {
  const existing = await getAnnouncement(db, id);
  const existingRecipientIds =
    input.recipientUserIds !== undefined
      ? input.recipientUserIds
      : await getAnnouncementRecipientIds(db, id);
  const merged = {
    title: input.title ?? existing.title,
    body: input.body ?? existing.body,
    translations: input.translations ?? existing.translations,
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
  if (input.recipientUserIds !== undefined) {
    await replaceAnnouncementRecipients(db, id, input.recipientUserIds);
  }
  return updated;
}

export async function deleteAnnouncement(db: Queryable, id: number): Promise<Announcement> {
  const { rows } = await db.query(`DELETE FROM announcements WHERE id = $1 RETURNING *`, [id]);
  if (!rows[0]) throw new NotFoundError("Announcement not found");
  return rows[0];
}

export async function getAnnouncement(db: Queryable, id: number): Promise<Announcement> {
  const { rows } = await db.query(`SELECT * FROM announcements WHERE id = $1`, [id]);
  if (!rows[0]) throw new NotFoundError("Announcement not found");
  return rows[0];
}

export async function listAnnouncementsAdmin(db: Queryable): Promise<Announcement[]> {
  const { rows } = await db.query(`SELECT * FROM announcements ORDER BY created_at DESC`);
  return rows;
}

/** Public feed (H49/H50): only announcements currently inside their vigencia window. */
export async function listAnnouncementsPublic(db: Queryable): Promise<PublicAnnouncement[]> {
  const { rows } = await db.query(
    `SELECT id, title, body, translations, publish_at, expires_at, screen_placement FROM announcements
     WHERE (publish_at IS NULL OR publish_at <= now())
       AND (expires_at IS NULL OR expires_at > now())
     ORDER BY publish_at DESC NULLS LAST, created_at DESC`,
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
  await getAnnouncement(db, announcementId); // 404s if missing
  await db.query(
    `INSERT INTO announcement_reads (announcement_id, user_id) VALUES ($1, $2)
     ON CONFLICT (announcement_id, user_id) DO NOTHING`,
    [announcementId, userId],
  );
}

/**
 * Resolves who an announcement reaches: an explicit recipient list wins if
 * set; otherwise audience tags (sponsor/participant/mentor, same vocabulary
 * and "sponsor implies participant" rule as H59's schedule audiences —
 * see identity/role.ts's mentorOrParticipantType/computeMembershipFlags,
 * inlined here as one query to avoid an N+1 per user); otherwise everyone,
 * unchanged from before this feature existed.
 */
async function resolveRecipients(
  db: Queryable,
  announcement: Pick<Announcement, "id" | "audiences">,
): Promise<Array<{ id: number; language: string | null }>> {
  const targeted = await getAnnouncementRecipientIds(db, announcement.id);
  if (targeted.length > 0) {
    const { rows } = await db.query(`SELECT id, language FROM users WHERE id = ANY($1::int[])`, [
      targeted,
    ]);
    return rows as Array<{ id: number; language: string | null }>;
  }

  if (announcement.audiences.length === 0) {
    const { rows } = await db.query(`SELECT id, language FROM users`);
    return rows as Array<{ id: number; language: string | null }>;
  }

  const { rows } = await db.query(
    `WITH RECURSIVE user_groups AS (
       SELECT pgm.user_id, pgm.group_id
       FROM permission_group_members pgm
       UNION
       SELECT ug.user_id, gi.child_group_id
       FROM permission_group_includes gi
       JOIN user_groups ug ON ug.group_id = gi.parent_group_id
     ),
     staff AS (
       -- Same "holds at least one capability" definition as
       -- getEffectiveCapabilities/computeDerivedRole's staff bucket.
       SELECT DISTINCT ug.user_id
       FROM user_groups ug
       JOIN group_capabilities gc ON gc.group_id = ug.group_id
     ),
     attendee AS (
       SELECT u.id AS user_id,
         COALESCE(
           (SELECT mar.role FROM manual_attendee_roles mar
             WHERE mar.user_id = u.id AND mar.role IN ('mentor', 'participant')),
           (SELECT a.type FROM application_responses ar
              JOIN applications a ON a.id = ar.application_id
             WHERE ar.user_id = u.id AND ar.status <> 'draft' AND a.type IN ('mentor', 'participant')
             ORDER BY CASE a.type WHEN 'mentor' THEN 0 ELSE 1 END
             LIMIT 1)
         ) AS type
       FROM users u
     ),
     sponsor AS (
       SELECT DISTINCT user_id FROM sponsors WHERE user_id IS NOT NULL
     )
     SELECT u.id, u.language
     FROM users u
     LEFT JOIN attendee at ON at.user_id = u.id
     LEFT JOIN sponsor sp ON sp.user_id = u.id
     LEFT JOIN staff st ON st.user_id = u.id
     WHERE at.type = ANY($1::text[])
        OR (sp.user_id IS NOT NULL AND ($1::text[] && ARRAY['sponsor', 'participant']::text[]))
        OR (st.user_id IS NOT NULL AND 'staff' = ANY($1::text[]))`,
    [announcement.audiences],
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
    translations.es ?? { title: announcement.title, body: announcement.body }
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
  const recipients = await resolveRecipients(db, announcement);
  for (const recipient of recipients) {
    const content = translatedContent(announcement, recipient.language);
    await notify(db, {
      userId: recipient.id,
      category: "announcements",
      channels: announcement.channels,
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
