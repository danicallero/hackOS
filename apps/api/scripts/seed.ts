/**
 * Dev seed: a bootstrap admin user holding the "Platform administrator" role
 * created by migration 0801 (the `*` wildcard, H8). Idempotent — safe to
 * re-run. The admin's credentials are created via Better Auth once the
 * identity module lands; until then the user row exists for FK/testing
 * purposes.
 */
import pg from "pg";
import { DEFAULT_DATABASE_URL } from "./default-database-url.js";

const url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
const client = new pg.Client({ connectionString: url });
await client.connect();

try {
  await client.query("BEGIN");

  const role = await client.query(`SELECT id FROM roles WHERE name = 'Platform administrator'`);
  const roleId = role.rows[0]?.id;
  if (!roleId) {
    throw new Error("Platform administrator role not found — run migrations first");
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
