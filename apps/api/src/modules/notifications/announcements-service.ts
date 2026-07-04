import type { Queryable } from "../../db/pool.js";
import { NotFoundError } from "../../lib/errors.js";
import { notify } from "./service.js";

/**
 * H50 announcements: publish_at + expires_at is the vigencia window
 * ("aparece y desaparece solo"). DELTA(H50): expires_at + fanned_out_at are
 * new columns from migration 0600 — the boceto only had a start, and nothing
 * tracked whether the per-user fan-out had already run for a given row.
 */

export interface AnnouncementInput {
  title: string;
  body: string;
  targetRole: string | null;
  publishAt: string | null;
  expiresAt: string | null;
}

export interface Announcement {
  id: number;
  author_id: number;
  title: string;
  body: string;
  target_role: string | null;
  publish_at: string | null;
  expires_at: string | null;
  fanned_out_at: string | null;
  created_at: string;
}

export async function createAnnouncement(
  db: Queryable,
  authorId: number,
  input: AnnouncementInput,
): Promise<Announcement> {
  const { rows } = await db.query(
    `INSERT INTO announcements (author_id, title, body, target_role, publish_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [authorId, input.title, input.body, input.targetRole, input.publishAt, input.expiresAt],
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
    targetRole: input.targetRole !== undefined ? input.targetRole : existing.target_role,
    publishAt: input.publishAt !== undefined ? input.publishAt : existing.publish_at,
    expiresAt: input.expiresAt !== undefined ? input.expiresAt : existing.expires_at,
  };
  const { rows } = await db.query(
    `UPDATE announcements
     SET title = $2, body = $3, target_role = $4, publish_at = $5, expires_at = $6
     WHERE id = $1
     RETURNING *`,
    [id, merged.title, merged.body, merged.targetRole, merged.publishAt, merged.expiresAt],
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
export async function listAnnouncementsPublic(db: Queryable): Promise<Announcement[]> {
  const { rows } = await db.query(
    `SELECT * FROM announcements
     WHERE (publish_at IS NULL OR publish_at <= now())
       AND (expires_at IS NULL OR expires_at > now())
     ORDER BY publish_at DESC NULLS LAST, created_at DESC`,
  );
  return rows;
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
 * Resolves the target audience for `target_role` (DELTA(H50) simplification,
 * documented here since role is derived, not stored, per plan/07 invariant
 * 13): null = everyone; 'participant' = anyone with a submissions row (has a
 * project) OR a confirmed application; anything else falls back to everyone
 * for MVP rather than modelling every illustrative role as a real audience.
 */
async function resolveTargetUserIds(db: Queryable, targetRole: string | null): Promise<number[]> {
  if (targetRole === "participant") {
    const { rows } = await db.query(
      `SELECT DISTINCT u.id FROM users u
       WHERE EXISTS (SELECT 1 FROM submissions s WHERE s.user_id = u.id)
          OR EXISTS (
               SELECT 1 FROM application_responses ar
               WHERE ar.user_id = u.id AND ar.status = 'confirmed'
             )`,
    );
    return rows.map((r: { id: number }) => r.id);
  }
  const { rows } = await db.query(`SELECT id FROM users`);
  return rows.map((r: { id: number }) => r.id);
}

/**
 * Fans out in_app + push outbox rows (respecting H51 'announcements'
 * preferences) to the announcement's target audience, then marks it as
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
  const userIds = await resolveTargetUserIds(db, announcement.target_role);
  for (const userId of userIds) {
    await notify(db, {
      userId,
      category: "announcements",
      channels: ["in_app", "push"],
      payload: {
        template: "generic",
        subject: announcement.title,
        body: announcement.body,
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
  if (announcement.fanned_out_at) return;
  if (isCurrentlyVisible(announcement)) {
    await fanOutAnnouncement(db, announcement);
  }
}
