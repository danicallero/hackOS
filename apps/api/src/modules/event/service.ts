import type { Queryable } from "../../db/pool.js";

/** H45: other modules format event dates in the configured zone, never the host's. */
export async function getEventTimezone(db: Queryable): Promise<string> {
  const { rows } = await db.query<{ timezone: string }>(
    "SELECT timezone FROM event_config WHERE id = 1",
  );
  return rows[0]?.timezone || "UTC";
}
