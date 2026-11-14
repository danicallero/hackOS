import { pool, type Queryable } from "../../db/pool.js";

/** Edition this request is scoped to (X-Edition or the current one); rows keep their own key. */
export async function currentEventKey(db: Queryable = pool): Promise<string> {
  const { rows } = await db.query<{ event_key: string }>("SELECT current_edition() AS event_key");
  return rows[0]?.event_key ?? "default";
}
