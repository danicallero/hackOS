import pg from "pg";

/**
 * Grants superadmin (ADMIN_ALL / '*') to an EXISTING user account (H8).
 *
 * Production-safe execution (no tsx/pnpm needed):
 *   node scripts/grant-superadmin.mjs --email user@example.com [--allow-existing-admin]
 */

function readFlag(name) {
  const i = process.argv.indexOf(name);
  if (i === -1) return undefined;
  return process.argv[i + 1];
}

function hasFlag(name) {
  return process.argv.includes(name);
}

const email = readFlag("--email")?.trim().toLowerCase();
const allowExistingAdmin = hasFlag("--allow-existing-admin");

if (!email) {
  throw new Error("Missing required flag: --email");
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

try {
  await client.query("BEGIN");

  if (!allowExistingAdmin) {
    const { rows: existingAdmins } = await client.query(
      `SELECT 1 FROM user_effective_capabilities WHERE capability = $1 LIMIT 1`,
      ["*"],
    );
    if (existingAdmins.length > 0) {
      throw new Error(
        "A superadmin already exists. Pass --allow-existing-admin to intentionally add another one.",
      );
    }
  }

  const { rows: users } = await client.query(`SELECT id FROM users WHERE email = $1`, [email]);
  if (!users[0]) {
    throw new Error(`User not found: ${email}`);
  }
  const userId = users[0].id;

  // Always keep this role above every other role, even one added after the
  // last time this script ran.
  const { rows: positionRows } = await client.query(
    `SELECT COALESCE(MAX(position), 0) + 1000 AS position FROM roles WHERE name <> 'system:superadmin'`,
  );
  const position = positionRows[0].position;
  // H8: system:superadmin must never be a user's shown "public role" — it is
  // real, auditable state (who holds it), but is_visible = false keeps it out
  // of the highest-position-visible-role computation (role.ts) permanently.
  const { rows: roles } = await client.query(
    `INSERT INTO roles (name, position, is_protected, is_visible)
     VALUES ('system:superadmin', $1, true, false)
     ON CONFLICT (name) DO UPDATE SET
       position = EXCLUDED.position, is_protected = true, is_visible = false
     RETURNING id`,
    [position],
  );
  const roleId = roles[0].id;

  await client.query(
    `INSERT INTO role_capabilities (role_id, capability, state)
     VALUES ($1, $2, 'allow')
     ON CONFLICT (role_id, capability) DO UPDATE SET state = 'allow'`,
    [roleId, "*"],
  );

  await client.query(
    `INSERT INTO user_roles (user_id, role_id, assigned_by)
     VALUES ($1, $2, $1)
     ON CONFLICT DO NOTHING`,
    [userId, roleId],
  );

  await client.query(`UPDATE users SET email_verified = true WHERE id = $1`, [userId]);

  await client.query(
    `DELETE FROM notification_outbox
     WHERE user_id = $1 AND status = 'queued' AND payload->>'template' = 'auth.verify'`,
    [userId],
  );

  await client.query(
    `INSERT INTO audit_log (actor_id, entity_type, entity_id, action, source, after)
     VALUES ($1::int, 'user', $1::text, 'grant_superadmin', 'system', $2::jsonb)`,
    [userId, JSON.stringify({ email, capability: "*", roleId })],
  );

  await client.query("COMMIT");
  console.log(`Granted superadmin for user #${userId} (${email}) via role #${roleId}.`);
} catch (err) {
  await client.query("ROLLBACK");
  throw err;
} finally {
  await client.end();
}
