import { CAPABILITIES } from "@hackos/shared/capabilities";
import { pool, withTransaction } from "../src/db/pool.js";
import { audit } from "../src/lib/audit.js";
import { auth } from "../src/modules/identity/auth.js";

/**
 * Creates or upgrades a superadmin account from a server shell (Docker/SSH)
 * by attaching ADMIN_ALL via permission groups (H8).
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
    `SELECT 1
     FROM permission_group_members pgm
     JOIN group_capabilities gc ON gc.group_id = pgm.group_id
     WHERE gc.capability = $1
     LIMIT 1`,
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

  const { groupId } = await withTransaction(async (client) => {
    const groupName = "system:superadmin";
    const { rows: existingGroupRows } = await client.query(
      `SELECT id FROM permission_groups WHERE name = $1`,
      [groupName],
    );
    const groupId =
      existingGroupRows.length > 0
        ? (existingGroupRows[0].id as number)
        : (
            await client.query(
              `INSERT INTO permission_groups (name, description)
               VALUES ($1, $2)
               RETURNING id`,
              [groupName, "System bootstrap group for superadmin users"],
            )
          ).rows[0].id;

    await client.query(
      `INSERT INTO group_capabilities (group_id, capability)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [groupId, CAPABILITIES.ADMIN_ALL],
    );

    await client.query(
      `INSERT INTO permission_group_members (user_id, group_id, assigned_by)
       VALUES ($1, $2, $1)
       ON CONFLICT DO NOTHING`,
      [userId, groupId],
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
      after: { email, capability: CAPABILITIES.ADMIN_ALL, groupId },
    });

    return { groupId };
  });

  console.log(
    `${action === "create_superadmin" ? "Created" : "Granted"} superadmin for user #${userId} (${email}) in permission group #${groupId} (H8).`,
  );
}

try {
  await main();
} finally {
  await pool.end();
}
