import type { Queryable } from "../../db/pool.js";
import { ConflictError, NotFoundError } from "../../lib/errors.js";
import { assertProjectWindow } from "./policy.js";
export async function assertProjectEditable(db: Queryable, id: number) {
  const { rows } = await db.query("SELECT lock_reason FROM repos WHERE id=$1 FOR UPDATE", [id]);
  if (!rows[0]) throw new NotFoundError("Project not found");
  if (rows[0].lock_reason === "organizer_lock")
    throw new ConflictError("Project locked by organizer");
}
export async function assertProjectParticipantWindow(db: Queryable, _id: number) {
  await assertProjectWindow(db);
}
