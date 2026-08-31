import { CAPABILITIES } from "@hackos/shared/capabilities";
import { pool, withTransaction } from "../src/db/pool.js";
import { audit } from "../src/lib/audit.js";
import { auth } from "../src/modules/identity/auth.js";

/**
 * Creates or upgrades a superadmin account from a server shell (Docker/SSH)
 * by attaching ADMIN_ALL via a dedicated, always-highest-position role (H8).
 *
 * Usage:
 *   pnpm --filter @hackos/api superadmin:create --email root@example.com [--password 'secret123' --name Root --surname Admin] [--language en|es|gl] [--allow-existing-admin]
 *
 * If --email already exists, this script grants superadmin to that account.
 * If it does not exist, it creates the account (requiring --password, --name,
 * and --surname) and then grants superadmin.
 */

type Language = "en" | "es" | "gl";

function readFlag(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i === -1) return undefined;
  return process.argv[i + 1];
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function requiredFlag(name: string): string {
  const value = readFlag(name);
  if (!value) {
    throw new Error(`Missing required flag: ${name}`);
  }
  return value;
}

function requireFlagIfMissing(name: string, current: string | undefined): string {
  if (current) return current;
  throw new Error(`Missing required flag for new account creation: ${name}`);
}

async function hasAdminAllUser(): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM user_effective_capabilities WHERE capability = $1 LIMIT 1`,
    [CAPABILITIES.ADMIN_ALL],
  );
  return rows.length > 0;
}

async function main(): Promise<void> {
  const email = requiredFlag("--email").trim().toLowerCase();
  const password = readFlag("--password");
  const name = readFlag("--name");
  const surname = readFlag("--surname");
  const language = readFlag("--language") as Language | undefined;
  const allowExistingAdmin = hasFlag("--allow-existing-admin");

  if (language !== undefined && !["en", "es", "gl"].includes(language)) {
    throw new Error("Invalid --language. Expected one of: en, es, gl");
  }
  if (password !== undefined && password.length < 8) {
    throw new Error("Password must be at least 8 characters");
  }

  if (!allowExistingAdmin && (await hasAdminAllUser())) {
    throw new Error(
      "A superadmin already exists. Pass --allow-existing-admin if you intentionally want another one.",
    );
  }

  const { rows: existingUserRows } = await pool.query(`SELECT id FROM users WHERE email = $1`, [
    email,
  ]);
  const existingUserId = existingUserRows.length > 0 ? (existingUserRows[0].id as number) : null;

  let userId: number;
  let action: "create_superadmin" | "grant_superadmin";
  if (existingUserId !== null) {
    userId = existingUserId;
    action = "grant_superadmin";
  } else {
    const signup = await auth.api.signUpEmail({
      body: {
        email,
        password: requireFlagIfMissing("--password", password),
        name: requireFlagIfMissing("--name", name),
        surname: requireFlagIfMissing("--surname", surname),
        language,
      },
    });
    userId = Number(signup.user.id);
    action = "create_superadmin";
  }

  const { roleId } = await withTransaction(async (client) => {
    const roleName = "system:superadmin";
    // Always keep this role above every other role, even one added after the
    // last time this script ran — recompute its position on every invocation.
    const { rows: positionRows } = await client.query(
      `SELECT COALESCE(MAX(position), 0) + 1000 AS position FROM roles WHERE name <> $1`,
      [roleName],
    );
    const position = Number(positionRows[0].position);
    // H8: system:superadmin must never be a user's shown "public role" — it is
    // real, auditable state (who holds it), but is_visible = false keeps it
    // out of the highest-position-visible-role computation (role.ts).
    const { rows: roleRows } = await client.query(
      `INSERT INTO roles (name, position, is_protected, is_visible, badge_category)
       VALUES ($1, $2, true, false, 'admin')
       ON CONFLICT (name) DO UPDATE SET
         position = EXCLUDED.position, is_protected = true, is_visible = false, badge_category = 'admin'
       RETURNING id`,
      [roleName, position],
    );
    const roleId = roleRows[0].id as number;

    await client.query(
      `INSERT INTO role_capabilities (role_id, capability, state)
       VALUES ($1, $2, 'allow')
       ON CONFLICT (role_id, capability) DO UPDATE SET state = 'allow'`,
      [roleId, CAPABILITIES.ADMIN_ALL],
    );

    await client.query(
      `INSERT INTO user_roles (user_id, role_id, assigned_by)
       VALUES ($1, $2, $1)
       ON CONFLICT DO NOTHING`,
      [userId, roleId],
    );

    await client.query(
      `UPDATE users
       SET email_verified = true,
           language = COALESCE($2, language)
       WHERE id = $1`,
      [userId, language],
    );

    await client.query(
      `DELETE FROM notification_outbox
       WHERE user_id = $1 AND status = 'queued' AND payload->>'template' = 'auth.verify'`,
      [userId],
    );

    await audit(client, {
      actorId: userId,
      entityType: "user",
      entityId: userId,
      action,
      source: "system",
      after: { email, capability: CAPABILITIES.ADMIN_ALL, roleId },
    });

    return { roleId };
  });

  console.log(
    `${action === "create_superadmin" ? "Created" : "Granted"} superadmin for user #${userId} (${email}) via role #${roleId} (H8).`,
  );
}

try {
  await main();
} finally {
  await pool.end();
}
