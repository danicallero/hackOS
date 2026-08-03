import type { Queryable } from "../../db/pool.js";
import { BadRequestError, NotFoundError } from "../../lib/errors.js";
import { DEFAULT_CHANNELS, notify } from "./service.js";

/**
 * H50 announcements: publish_at + expires_at is the vigencia window
 * ("aparece y desaparece solo"). DELTA(H50): expires_at + fanned_out_at are
 * new columns from migration 0600 — the boceto only had a start, and nothing
 * tracked whether the per-user fan-out had already run for a given row.
 */

export interface AnnouncementInput {
  title: string;
  body: string;
  translations: AnnouncementTranslations;
  notifyUsers: boolean;
  screenPlacement: ScreenPlacement;
  publishAt: string | null;
  expiresAt: string | null;
}

export const SCREEN_PLACEMENTS = ["none", "embedded", "fullscreen"] as const;
export type ScreenPlacement = (typeof SCREEN_PLACEMENTS)[number];
export type AnnouncementLanguage = "es" | "gl" | "en";
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

function assertVisibilityWindow(publishAt: string | null, expiresAt: string | null): void {
  if (publishAt && expiresAt && new Date(expiresAt).getTime() <= new Date(publishAt).getTime()) {
    throw new BadRequestError("An announcement must expire after it becomes visible");
  }
}

export async function createAnnouncement(
  db: Queryable,
  authorId: number,
  input: AnnouncementInput,
): Promise<Announcement> {
  assertVisibilityWindow(input.publishAt, input.expiresAt);
  const { rows } = await db.query(
    `INSERT INTO announcements
       (author_id, title, body, translations, notify_users, screen_placement, publish_at, expires_at)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8)
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
    ],
  );
  return rows[0];
}

export async function updateAnnouncement(
  db: Queryable,
  id: number,
  input: Partial<AnnouncementInput>,
): Promise<Announcement> {
  const existing = await getAnnouncement(db, id);
  const merged = {
    title: input.title ?? existing.title,
    body: input.body ?? existing.body,
    translations: input.translations ?? existing.translations,
    notifyUsers: input.notifyUsers ?? existing.notify_users,
    screenPlacement: input.screenPlacement ?? existing.screen_placement,
    publishAt: input.publishAt !== undefined ? input.publishAt : existing.publish_at,
    expiresAt: input.expiresAt !== undefined ? input.expiresAt : existing.expires_at,
  };
  assertVisibilityWindow(merged.publishAt, merged.expiresAt);
  const { rows } = await db.query(
    `UPDATE announcements
     SET title = $2, body = $3, translations = $4::jsonb, notify_users = $5,
         screen_placement = $6, publish_at = $7, expires_at = $8
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
    ],
  );
  return rows[0];
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

/** Every announcement is addressed to every account; people decide their own channels in H51 preferences. */
async function resolveRecipients(
  db: Queryable,
): Promise<Array<{ id: number; language: string | null }>> {
  const { rows } = await db.query(`SELECT id, language FROM users`);
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
 * Fans out the supported participant channels (respecting H51 preferences)
 * to every account, then marks it as
 * fanned out so a later poll of the visibility publisher doesn't repeat it.
 * NOT idempotent by itself — it always re-sends, so callers must gate on
 * fanned_out_at IS NULL (fanOutIfVisibleNow below, and the publisher's
 * claim query in announcements-publisher.ts both do).
 *
 * Mutates `announcement.fanned_out_at` so callers holding the row object
 * (e.g. the create route returning it as the response body) see the marker
 * without a re-read.
 */
export async function fanOutAnnouncement(db: Queryable, announcement: Announcement): Promise<void> {
  if (!announcement.notify_users) return;
  const recipients = await resolveRecipients(db);
  for (const recipient of recipients) {
    const content = translatedContent(announcement, recipient.language);
    await notify(db, {
      userId: recipient.id,
      category: "announcements",
      channels: DEFAULT_CHANNELS,
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
