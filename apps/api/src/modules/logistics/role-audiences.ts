import type { Queryable } from "../../db/pool.js";
import { pool } from "../../db/pool.js";

/**
 * The audience tags of the publicly visible roles a user holds (`role:<id>`), so
 * an item that names a role reaches everyone who holds at least one of them.
 */
export async function roleAudienceTagsForUsers(
  userIds: number[],
  db: Queryable = pool,
): Promise<Map<number, `role:${number}`[]>> {
  const result = new Map<number, `role:${number}`[]>();
  if (userIds.length === 0) return result;
  const { rows } = await db.query<{ user_id: number; role_id: number }>(
    `SELECT ur.user_id, ur.role_id
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = ANY($1::int[]) AND r.is_visible AND r.deleted_at IS NULL`,
    [userIds],
  );
  for (const row of rows) {
    const tags = result.get(row.user_id) ?? [];
    tags.push(`role:${row.role_id}`);
    result.set(row.user_id, tags);
  }
  return result;
}
