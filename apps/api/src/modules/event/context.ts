import { pool, type Queryable } from "../../db/pool.js";

/** Current edition key; historical answer rows keep their own key. */
export async function currentEventKey(db: Queryable = pool): Promise<string> {
  const { rows } = await db.query<{ event_key: string }>(
    "SELECT event_key FROM event_config WHERE id = 1",
  );
  return rows[0]?.event_key ?? "default";
}
