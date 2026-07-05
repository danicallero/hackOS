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
      `SELECT 1
       FROM permission_group_members pgm
       JOIN group_capabilities gc ON gc.group_id = pgm.group_id
       WHERE gc.capability = $1
       LIMIT 1`,
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

  const { rows: groups } = await client.query(
    `INSERT INTO permission_groups (name, description)
     VALUES ('system:superadmin', 'System bootstrap group for superadmin users')
     ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description
     RETURNING id`,
  );
  const groupId = groups[0].id;

  await client.query(
    `INSERT INTO group_capabilities (group_id, capability)
     VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [groupId, "*"],
  );

  await client.query(
    `INSERT INTO permission_group_members (user_id, group_id, assigned_by)
     VALUES ($1, $2, $1)
     ON CONFLICT DO NOTHING`,
    [userId, groupId],
  );

  await client.query(`UPDATE users SET email_verified = true WHERE id = $1`, [userId]);

  await client.query(
    `DELETE FROM notification_outbox
     WHERE user_id = $1 AND status = 'queued' AND payload->>'template' = 'auth.verify'`,
    [userId],
  );

  await client.query(
    `INSERT INTO audit_log (actor_id, entity_type, entity_id, action, source, after)
     VALUES ($1, 'user', $1::text, 'grant_superadmin', 'system', $2::jsonb)`,
    [userId, JSON.stringify({ email, capability: "*", groupId })],
  );

  await client.query("COMMIT");
  console.log(`Granted superadmin for user #${userId} (${email}) in permission group #${groupId}.`);
} catch (err) {
  await client.query("ROLLBACK");
  throw err;
} finally {
  await client.end();
}
