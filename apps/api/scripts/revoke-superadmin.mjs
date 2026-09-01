import pg from "pg";

/**
 * Revokes superadmin (system:superadmin) from an EXISTING user account (H8).
 * system:superadmin is CLI-only — it can never be granted or revoked through
 * the HTTP API (apps/api/src/modules/identity/routes/roles.ts refuses it
 * unconditionally, even for a '*'-holding actor) — this script, grant-
 * superadmin.mjs, and create-superadmin.ts are the only way to change it.
 *
 * Refuses to run if it would leave zero active superadmins, mirroring the
 * "at least one wildcard holder" invariant enforced elsewhere
 * (role-authority.ts's assertActiveWildcardHolder) by replicating the same
 * resolved-tri-state-chain query, scoped to system:superadmin specifically
 * and excluding the target user's own membership.
 *
 * Production-safe execution (no tsx/pnpm needed):
 *   node scripts/revoke-superadmin.mjs --email user@example.com
 */

function readFlag(name) {
  const i = process.argv.indexOf(name);
  if (i === -1) return undefined;
  return process.argv[i + 1];
}

const email = readFlag("--email")?.trim().toLowerCase();

if (!email) {
  throw new Error("Missing required flag: --email");
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

try {
  await client.query("BEGIN");

  const { rows: users } = await client.query(`SELECT id FROM users WHERE email = $1`, [email]);
  if (!users[0]) {
    throw new Error(`User not found: ${email}`);
  }
  const userId = users[0].id;

  const { rows: roles } = await client.query(
    `SELECT id FROM roles WHERE name = 'system:superadmin' AND deleted_at IS NULL`,
  );
  const role = roles[0];
  if (!role) {
    throw new Error("No system:superadmin role exists.");
  }
  const roleId = role.id;

  const { rows: membership } = await client.query(
    `SELECT 1 FROM user_roles WHERE user_id = $1 AND role_id = $2`,
    [userId, roleId],
  );
  if (membership.length === 0) {
    throw new Error(`User ${email} does not hold system:superadmin.`);
  }

  // At-least-one-active-superadmin guard: resolve every OTHER active user's
  // tri-state chain over system:superadmin's capabilities and require at
  // least one ALLOW to survive after this user's membership is removed.
  const { rows: remaining } = await client.query(
    `WITH candidate AS (
       SELECT ur.user_id, r.position, COALESCE(rc.state, 'inherit') AS state
         FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id
         JOIN users u ON u.id = ur.user_id
         LEFT JOIN role_capabilities rc ON rc.role_id = r.id AND rc.capability = '*'
        WHERE u.account_state = 'active' AND u.anonymized_at IS NULL
          AND r.deleted_at IS NULL
          AND ur.user_id <> $1
     ), resolved AS (
       SELECT DISTINCT ON (user_id) user_id, state
         FROM candidate
        WHERE state <> 'inherit'
        ORDER BY user_id, position DESC
     )
     SELECT 1 FROM resolved WHERE state = 'allow' LIMIT 1`,
    [userId],
  );
  if (remaining.length === 0) {
    throw new Error(
      "Refusing: this would leave zero active superadmins. Grant another account superadmin first.",
    );
  }

  await client.query(`DELETE FROM user_roles WHERE user_id = $1 AND role_id = $2`, [
    userId,
    roleId,
  ]);

  await client.query(
    `INSERT INTO audit_log (actor_id, entity_type, entity_id, action, source, before)
     VALUES ($1, 'user', $1::text, 'revoke_superadmin', 'system', $2::jsonb)`,
    [userId, JSON.stringify({ email, capability: "*", roleId })],
  );

  await client.query("COMMIT");
  console.log(`Revoked superadmin from user #${userId} (${email}) (role #${roleId}).`);
} catch (err) {
  await client.query("ROLLBACK");
  throw err;
} finally {
  await client.end();
}
