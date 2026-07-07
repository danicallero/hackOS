import { CAPABILITIES } from "@hackos/shared/capabilities";
import { pool } from "../../db/pool.js";
import { requireAnyCapability, userHasCapability } from "../../lib/capabilities.js";
import { ForbiddenError, UnauthorizedError } from "../../lib/errors.js";

/**
 * Several queue actions are legitimately reachable from more than one
 * capability (e.g. notify_enter and no_show are both a judge-view action AND
 * an operator-view action). `requireAnyCapability` now lives in the shared
 * capabilities lib; re-exported here to keep the queue module's imports stable.
 */
export { requireAnyCapability };

/**
 * CSV exports contain team/evaluation data, so `judging:export` is necessary
 * but not sufficient for scoped users. Global queue/project admins may export
 * any challenge; judges and sponsor reps are limited to their assigned/owned
 * challenges.
 */
export async function assertCanExportChallenge(
  userId: number | null,
  challengeId: number,
): Promise<void> {
  if (userId == null) throw new UnauthorizedError();
  if (!(await userHasCapability(userId, CAPABILITIES.JUDGING_EXPORT))) {
    throw new ForbiddenError(`Missing capability: ${CAPABILITIES.JUDGING_EXPORT}`, {
      capability: CAPABILITIES.JUDGING_EXPORT,
    });
  }

  const isGlobalExporter =
    (await userHasCapability(userId, CAPABILITIES.QUEUE_ADMIN)) ||
    (await userHasCapability(userId, CAPABILITIES.PROJECTS_READ));
  if (isGlobalExporter) return;

  const { rowCount } = await pool.query(
    `SELECT 1
       FROM challenges c
      WHERE c.id = $1
        AND (
          EXISTS (
            SELECT 1
              FROM room_judges rj
             WHERE rj.challenge_id = c.id
               AND rj.user_id = $2
          )
          OR EXISTS (
            SELECT 1
              FROM sponsors author
              JOIN sponsors mine ON mine.enterprise_id = author.enterprise_id
             WHERE author.id = c.author
               AND mine.user_id = $2
          )
        )
      LIMIT 1`,
    [challengeId, userId],
  );
  if (rowCount === 0) {
    throw new ForbiddenError("Not allowed to export this challenge", { challengeId });
  }
}
