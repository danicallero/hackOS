/**
 * Dev seed: an "admin" capability group holding the `*` wildcard (H8) and a
 * bootstrap admin user in it. Idempotent — safe to re-run.
 * The admin's credentials are created via Better Auth once the identity
 * module lands; until then the user row exists for FK/testing purposes.
 */
import pg from "pg";
import { DEFAULT_DATABASE_URL } from "./default-database-url.js";

const url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
const client = new pg.Client({ connectionString: url });
await client.connect();

try {
  await client.query("BEGIN");

  const group = await client.query(
    `INSERT INTO permission_groups (name, description)
     VALUES ('admin', 'Full access — every capability via the * wildcard')
     ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description
     RETURNING id`,
  );
  const groupId = group.rows[0].id;

  await client.query(
    `INSERT INTO group_capabilities (group_id, capability) VALUES ($1, '*')
     ON CONFLICT DO NOTHING`,
    [groupId],
  );

  const admin = await client.query(
    `INSERT INTO users (email, name, email_verified, language)
     VALUES ('admin@hackos.local', 'Admin', true, 'en')
     ON CONFLICT (email) DO UPDATE SET updated_at = now()
     RETURNING id`,
  );
  const adminId = admin.rows[0].id;

  await client.query(
    `INSERT INTO permission_group_members (user_id, group_id) VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [adminId, groupId],
  );

  await client.query("COMMIT");
  console.log(`Seeded: admin group #${groupId}, admin user #${adminId} (admin@hackos.local)`);
} catch (err) {
  await client.query("ROLLBACK");
  throw err;
} finally {
  await client.end();
}
