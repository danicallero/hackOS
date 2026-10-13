import type { Queryable } from "../../db/pool.js";
import { ConflictError, NotFoundError } from "../../lib/errors.js";
import { assertWithinHackingWindow } from "../../lib/hacking-window.js";

/** H20/H21: serialize editing against submit/lock/reopen on the repo row. A
 * submission alone never locks a project; only an organizer lock does. */
export async function assertProjectEditable(db: Queryable, repoId: number) {
  const { rows } = await db.query(`SELECT locked_at FROM repos WHERE id=$1 FOR UPDATE`, [repoId]);
  if (!rows[0]) throw new NotFoundError("Project not found");
  if (rows[0].locked_at)
    throw new ConflictError("Project locked by organizers; request edits", {
      code: "project_locked",
    });
}

/** An organizer reopening a submitted project is a scoped editing exception. */
export async function hasReopenedProject(db: Queryable, repoId: number) {
  const { rows } = await db.query(
    `SELECT submission_status='draft' AND submitted_at IS NOT NULL AND locked_at IS NULL AS reopened FROM repos WHERE id=$1`,
    [repoId],
  );
  return rows[0]?.reopened === true;
}
export async function assertProjectParticipantWindow(db: Queryable, repoId: number) {
  if (await hasReopenedProject(db, repoId)) return;
  await assertWithinHackingWindow(db);
}
