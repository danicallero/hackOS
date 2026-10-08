import type { Queryable } from "../../db/pool.js";
import { ConflictError, NotFoundError } from "../../lib/errors.js";

/** H19/H20: serialize editing against submit/import/unlock on the repo row. */
export async function assertProjectEditable(db: Queryable, repoId: number) {
  const { rows } = await db.query(`SELECT locked_at FROM repos WHERE id=$1 FOR UPDATE`, [repoId]);
  if (!rows[0]) throw new NotFoundError("Project not found");
  if (rows[0].locked_at)
    throw new ConflictError("Project submitted and locked; request edits", {
      code: "project_locked",
    });
}
export async function assertGroupEditable(db: Queryable, groupId: number) {
  const { rows } = await db.query(
    `SELECT linked_repo_id FROM planned_work_groups WHERE id=$1 FOR UPDATE`,
    [groupId],
  );
  if (!rows[0]) throw new NotFoundError("Project not found");
  if (rows[0].linked_repo_id) await assertProjectEditable(db, Number(rows[0].linked_repo_id));
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
  const { assertWithinHackingWindow } = await import("../../lib/hacking-window.js");
  await assertWithinHackingWindow(db);
}
export async function assertGroupParticipantWindow(db: Queryable, groupId: number) {
  const { rows } = await db.query(`SELECT linked_repo_id FROM planned_work_groups WHERE id=$1`, [
    groupId,
  ]);
  if (rows[0]?.linked_repo_id && (await hasReopenedProject(db, Number(rows[0].linked_repo_id))))
    return;
  const { assertWithinParticipantSelfServiceWindow } = await import("../../lib/hacking-window.js");
  await assertWithinParticipantSelfServiceWindow(db);
}
