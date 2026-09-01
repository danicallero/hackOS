import pg from "pg";

/**
 * Lists every account currently holding superadmin (ADMIN_ALL / '*') via the
 * CLI-only `system:superadmin` role (H8).
 *
 * Production-safe execution (no tsx/pnpm needed):
 *   node scripts/list-superadmins.mjs
 */

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

try {
  const { rows } = await client.query(
    `SELECT u.id, u.email, u.name, u.surname, ur.assigned_at
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
       JOIN users u ON u.id = ur.user_id
      WHERE r.name = 'system:superadmin' AND r.deleted_at IS NULL
      ORDER BY ur.assigned_at ASC`,
  );

  if (rows.length === 0) {
    console.log("No account currently holds superadmin.");
  } else {
    console.log(`${rows.length} account(s) hold superadmin:\n`);
    for (const row of rows) {
      console.log(
        `#${row.id}  ${row.email}  (${row.name} ${row.surname})  granted ${row.assigned_at.toISOString()}`,
      );
    }
  }
} finally {
  await client.end();
}
