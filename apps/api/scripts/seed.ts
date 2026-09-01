/**
 * Dev seed: a bootstrap admin user holding a "Platform administrator" role
 * (the `*` wildcard, H8). Idempotent — safe to re-run. Since 0801 only
 * carries over a "Platform administrator" role when a real installation's
 * pre-existing `permission_groups` data used that template, a fresh dev
 * database won't have one yet — this script creates it on demand instead of
 * requiring it pre-exist. The admin's credentials are created via Better
 * Auth once the identity module lands; until then the user row exists for
 * FK/testing purposes.
 */
import { CAPABILITIES } from "@hackos/shared/capabilities";
import pg from "pg";
import { DEFAULT_DATABASE_URL } from "./default-database-url.js";

const url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
const client = new pg.Client({ connectionString: url });
await client.connect();

try {
  await client.query("BEGIN");

  const existing = await client.query(`SELECT id FROM roles WHERE name = 'Platform administrator'`);
  let roleId = existing.rows[0]?.id;
  if (!roleId) {
    const { rows: positionRows } = await client.query(
      `SELECT COALESCE(MAX(position), 0) + 1000 AS position FROM roles`,
    );
    const inserted = await client.query(
      `INSERT INTO roles (name, position, is_visible, is_protected)
       VALUES ('Platform administrator', $1, true, true)
       ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [positionRows[0].position],
    );
    roleId = inserted.rows[0].id;
    await client.query(
      `INSERT INTO role_capabilities (role_id, capability, state)
       VALUES ($1, $2, 'allow')
       ON CONFLICT (role_id, capability) DO UPDATE SET state = 'allow'`,
      [roleId, CAPABILITIES.ADMIN_ALL],
    );
  }

  const admin = await client.query(
    `INSERT INTO users (email, name, email_verified, language)
     VALUES ('admin@hackos.local', 'Admin', true, 'en')
     ON CONFLICT (email) DO UPDATE SET updated_at = now()
     RETURNING id`,
  );
  const adminId = admin.rows[0].id;

  await client.query(
    `INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [adminId, roleId],
  );

  await client.query("COMMIT");
  console.log(`Seeded: admin user #${adminId} (admin@hackos.local) with role #${roleId}`);
} catch (err) {
  await client.query("ROLLBACK");
  throw err;
} finally {
  await client.end();
}
