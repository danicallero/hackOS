import type { Pool } from "pg";

/** truncateAll() empties event_config; attendance kinds and RSVPs hang off its singleton row. */
export async function seedEventConfig(pool: Pool, eventKey = "default"): Promise<void> {
  await pool.query(
    `INSERT INTO event_config (id, event_key) VALUES (1, $1)
     ON CONFLICT (id) DO UPDATE SET event_key = EXCLUDED.event_key`,
    [eventKey],
  );
}
