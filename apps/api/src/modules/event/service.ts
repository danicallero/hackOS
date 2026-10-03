import { config } from "../../config.js";
import type { Queryable } from "../../db/pool.js";

/** H45: other modules format event dates in the configured zone, never the host's. */
export async function getEventTimezone(db: Queryable): Promise<string> {
  const { rows } = await db.query<{ timezone: string }>(
    "SELECT timezone FROM event_config WHERE id = 1",
  );
  return rows[0]?.timezone || "UTC";
}

/** H45/H52: use the configured event identity, with the same fallback as Wallet. */
export async function getEventName(db: Queryable): Promise<string> {
  const { rows } = await db.query<{ name: string | null }>(
    "SELECT name FROM event_config WHERE id = 1",
  );
  return rows[0]?.name?.trim() || config.APPLE_PASS_ORGANIZATION;
}
