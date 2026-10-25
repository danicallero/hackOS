import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import type { Queryable } from "../../db/pool.js";
import { withTransaction } from "../../db/pool.js";
import { audit, auditMany } from "../../lib/audit.js";
import { createAuthorizationContext, userHasCapability } from "../../lib/capabilities.js";
import { BadRequestError, NotFoundError } from "../../lib/errors.js";
import { sharedCache } from "../../lib/shared-cache.js";
import { broadcast } from "../../lib/sse.js";
import { canViewGallery } from "../projects/policy.js";

export async function winnerPublication(db: Queryable, id: number) {
  const { rows } = await db.query(
    `SELECT winners_publish_at AS "publishAt",winners_published_at AS "publishedAt" FROM challenges WHERE id=$1`,
    [id],
  );
  if (!rows[0]) throw new NotFoundError("Challenge not found");
  return rows[0];
}
export async function scheduleWinners(actorId: number, id: number, publishAt: string | null) {
  return withTransaction(async (db) => {
    await db.query(`SELECT id FROM challenges WHERE id=$1 FOR UPDATE`, [id]);
    const before = await winnerPublication(db, id);
    if (
      publishAt &&
      !(await db.query(`SELECT $1::timestamptz>now() AS future`, [publishAt])).rows[0].future
    )
      throw new BadRequestError("Publication schedule must be in the future");
    await db.query(`UPDATE challenges SET winners_publish_at=$2 WHERE id=$1`, [id, publishAt]);
    const after = await winnerPublication(db, id);
    await audit(db, {
      actorId,
      entityType: "challenge_winner_publication",
      entityId: id,
      action: "schedule",
      before,
      after,
    });
    return after;
  });
}
export async function announcePublishedWinners() {
  await broadcast(SSE_TOPICS.PUBLIC_CONTENT, EVENTS.DATA_CHANGED, {});
  await broadcast(SSE_TOPICS.PUBLIC_TV, EVENTS.DATA_CHANGED, {});
}
export async function publishWinnersNow(actorId: number, id: number) {
  const result = await withTransaction(async (db) => {
    const { rows } = await db.query(
      `SELECT winners_published_at FROM challenges WHERE id=$1 FOR UPDATE`,
      [id],
    );
    if (!rows[0]) throw new NotFoundError("Challenge not found");
    if (rows[0].winners_published_at)
      return { changed: false, publication: await winnerPublication(db, id) };
    await db.query(`UPDATE challenges SET winners_published_at=now() WHERE id=$1`, [id]);
    const publication = await winnerPublication(db, id);
    await audit(db, {
      actorId,
      entityType: "challenge_winner_publication",
      entityId: id,
      action: "publish",
      after: publication,
    });
    return { changed: true, publication };
  });
  if (result.changed) await announcePublishedWinners();
  return result.publication;
}
export async function publishDueWinners() {
  const ids = await withTransaction(async (db) => {
    const { rows } = await db.query(
      `SELECT id FROM challenges WHERE winners_published_at IS NULL AND winners_publish_at<=now() AND is_test_account=false ORDER BY id FOR UPDATE SKIP LOCKED`,
    );
    if (rows.length > 0) {
      await db.query(`UPDATE challenges SET winners_published_at=now() WHERE id=ANY($1::int[])`, [
        rows.map((row) => row.id),
      ]);
      await auditMany(
        db,
        rows.map((row) => ({
          actorId: null,
          entityType: "challenge_winner_publication",
          entityId: row.id,
          action: "scheduled_publish",
          source: "system",
          after: { published: true },
        })),
      );
    }
    return rows.map((row) => Number(row.id));
  });
  if (ids.length) await announcePublishedWinners();
  return ids;
}
/** Single nonprivileged projection: no winner property exists before publication (H60). */
export async function visibleWinnerRows(
  db: Queryable,
  userId: number | null,
  projectIds?: number[],
  /** The caller already ran the gallery audience check for the viewer this result is shared with. */
  accessChecked = false,
) {
  if (!accessChecked && !(await canViewGallery(db, userId))) return [];
  const { rows } = await db.query(
    `SELECT w.challenge_id AS "challengeId",w.rank,w.repo_id AS "repoId",c.title AS "challengeTitle",r.name AS "repoName" FROM challenge_winners w JOIN challenges c ON c.id=w.challenge_id JOIN repos r ON r.id=w.repo_id WHERE c.winners_published_at IS NOT NULL AND c.winners_published_at<=now() AND c.visibility='visible' AND c.is_test_account=false AND r.is_test_account=false AND r.submission_status='submitted' AND ($1::int[] IS NULL OR r.id=ANY($1)) ORDER BY c.id,w.rank`,
    [projectIds ?? null],
  );
  return rows;
}
/**
 * Published winners once the viewer passes the gallery audience check. The
 * rows are identical for every allowed viewer, so one query serves them all.
 */
export async function sharedVisibleWinnerRows(db: Queryable, userId: number | null) {
  if (!(await canViewGallery(db, userId))) return [];
  return sharedCache("public-content", "visible-winners", 15, () =>
    visibleWinnerRows(db, null, undefined, true),
  );
}
export async function canReadPrivateWinners(
  db: Queryable,
  userId: number | null,
  challengeId: number,
) {
  if (userId === null) return false;
  const context = createAuthorizationContext(userId, db);
  if (await userHasCapability(context, CAPABILITIES.CHALLENGES_MANAGE)) return true;
  return !!(
    await db.query(
      `SELECT 1 FROM challenges c JOIN sponsors author ON author.id=c.author JOIN sponsors mine ON mine.enterprise_id=author.enterprise_id JOIN users u ON u.id=mine.user_id WHERE c.id=$1 AND mine.user_id=$2 AND u.account_state='active' AND u.anonymized_at IS NULL`,
      [challengeId, userId],
    )
  ).rowCount;
}
