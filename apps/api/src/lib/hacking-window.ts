import type { Queryable } from "../db/pool.js";
import { ForbiddenError } from "./errors.js";

/**
 * H19/H20: participant self-service project mutations (edit, invite, leave,
 * delete) only run while the event's hacking window is open. Both bounds
 * must be explicitly configured — an unset window is treated as closed, not
 * "no restriction" — so an event that never set `hacking_starts_at`/
 * `hacking_ends_at` doesn't accidentally leave self-service open forever.
 * The comparison runs in SQL (`now() BETWEEN ...`) to avoid clock skew
 * between the API host and Postgres.
 */
export async function isWithinHackingWindow(db: Queryable): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT hacking_starts_at IS NOT NULL
        AND hacking_ends_at IS NOT NULL
        AND now() BETWEEN hacking_starts_at AND hacking_ends_at AS within
       FROM event_config WHERE id = 1`,
  );
  return rows[0]?.within === true;
}

/** Guard for every self-service mutation route (H19/H20): throws outside the window. */
export async function assertWithinHackingWindow(db: Queryable): Promise<void> {
  if (!(await isWithinHackingWindow(db))) {
    throw new ForbiddenError("Outside the hacking window; ask queue management for changes");
  }
}
