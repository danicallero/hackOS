import type { Queryable } from "../db/pool.js";
import { ForbiddenError } from "./errors.js";

/**
 * H19/H20: participant self-service project and work-group mutations run in
 * the configured participant window. Blank custom bounds inherit hacking.
 * The comparison runs in SQL (`now() BETWEEN ...`) to avoid clock skew
 * between the API host and Postgres.
 */
export async function isWithinHackingWindow(db: Queryable): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT COALESCE(participant_self_service_starts_at, hacking_starts_at) IS NOT NULL
        AND COALESCE(participant_self_service_ends_at, hacking_ends_at) IS NOT NULL
        AND now() BETWEEN COALESCE(participant_self_service_starts_at, hacking_starts_at)
                      AND COALESCE(participant_self_service_ends_at, hacking_ends_at) AS within
       FROM event_config WHERE id = 1`,
  );
  return rows[0]?.within === true;
}

/** Guard for every self-service mutation route (H19/H20): throws outside the window. */
export async function assertWithinHackingWindow(db: Queryable): Promise<void> {
  if (!(await isWithinHackingWindow(db))) {
    throw new ForbiddenError(
      "Outside the participant self-service window; ask queue management for changes",
    );
  }
}

/** Work-group planning predates the hacking-window gate. Keep it open until
 * an organizer explicitly configures a participant window, then enforce the
 * configured bounds (with the matching hacking bound as fallback). */
export async function assertWithinParticipantSelfServiceWindow(db: Queryable): Promise<void> {
  const { rows } = await db.query<{ configured: boolean; within: boolean }>(
    `SELECT (participant_self_service_starts_at IS NOT NULL
             OR participant_self_service_ends_at IS NOT NULL) AS configured,
            COALESCE(participant_self_service_starts_at, hacking_starts_at) IS NOT NULL
            AND COALESCE(participant_self_service_ends_at, hacking_ends_at) IS NOT NULL
            AND now() BETWEEN COALESCE(participant_self_service_starts_at, hacking_starts_at)
                          AND COALESCE(participant_self_service_ends_at, hacking_ends_at) AS within
       FROM event_config WHERE id = 1`,
  );
  if (rows[0]?.configured && !rows[0].within) {
    throw new ForbiddenError(
      "Outside the participant self-service window; ask queue management for changes",
    );
  }
}
