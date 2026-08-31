import type { App } from "../src/app.js";
import { pool } from "../src/db/pool.js";

/**
 * Truncate every domain table (keeps schema + the queue_settings singleton).
 * Call in beforeEach for DB-backed suites.
 */
export async function truncateAll(): Promise<void> {
  const { rows } = await pool.query(
    `SELECT tablename FROM pg_tables
     WHERE schemaname = 'public' AND tablename NOT IN ('_migrations', 'queue_settings')`,
  );
  if (rows.length === 0) return;
  const tables = rows.map((r: { tablename: string }) => `"${r.tablename}"`).join(", ");
  await pool.query(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
}

/** Insert a bare user row; returns its id. */
export async function createUser(
  overrides: Partial<{ email: string; name: string; emailVerified: boolean }> = {},
): Promise<number> {
  const email = overrides.email ?? `user-${crypto.randomUUID()}@test.local`;
  const { rows } = await pool.query(
    `INSERT INTO users (email, name, email_verified) VALUES ($1, $2, $3) RETURNING id`,
    [email, overrides.name ?? "Test User", overrides.emailVerified ?? true],
  );
  return rows[0].id;
}

/**
 * A unique, collision-free role position. ALLOW-only test roles (as created
 * by createUserWithCapabilities/createRole below) never need a particular
 * ordering relative to each other — no DENY exists in this codebase's own
 * migrated roles, so any unique integer is safe (see 0801's migration
 * comment for why ALLOW-only role membership is order-independent).
 */
function randomRolePosition(): number {
  return 1_000_000 + Math.floor(Math.random() * 1_000_000_000);
}

/** Create a role with the given ALLOW capabilities at a fresh unique position. */
export async function createRole(
  capabilities: string[] = [],
  overrides: Partial<{ name: string; isVisible: boolean; isProtected: boolean }> = {},
): Promise<number> {
  const name = overrides.name ?? `test-role-${crypto.randomUUID()}`;
  const { rows } = await pool.query(
    `INSERT INTO roles (name, position, is_visible, is_protected) VALUES ($1, $2, $3, $4) RETURNING id`,
    [name, randomRolePosition(), overrides.isVisible ?? true, overrides.isProtected ?? false],
  );
  const roleId = rows[0].id;
  for (const capability of capabilities) {
    await pool.query(
      `INSERT INTO role_capabilities (role_id, capability, state) VALUES ($1, $2, 'allow')`,
      [roleId, capability],
    );
  }
  return roleId;
}

/** Assign an existing role to a user. */
export async function assignRole(
  userId: number,
  roleId: number,
  assignedBy?: number,
): Promise<void> {
  await pool.query(
    `INSERT INTO user_roles (user_id, role_id, assigned_by) VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING`,
    [userId, roleId, assignedBy ?? null],
  );
}

/** Create a user holding the given capabilities (via a throwaway role). */
export async function createUserWithCapabilities(capabilities: string[]): Promise<number> {
  const userId = await createUser();
  const roleId = await createRole(capabilities);
  await assignRole(userId, roleId);
  return userId;
}

/**
 * Return the immutable snapshot for an application, creating the current
 * snapshot when the application was inserted directly by a test. Production
 * writes create this row alongside an application; direct SQL fixtures need
 * to preserve the same response invariant explicitly (H54).
 */
export async function ensureApplicationFormVersion(applicationId: number): Promise<number> {
  const { rows: existing } = await pool.query(
    `SELECT fv.id
       FROM application_form_versions fv
       JOIN applications a ON a.id = fv.application_id
      WHERE fv.application_id = $1
        AND fv.version = a.current_form_version
      LIMIT 1`,
    [applicationId],
  );
  if (existing[0]?.id != null) return existing[0].id;

  const { rows } = await pool.query(
    `INSERT INTO application_form_versions (application_id, version, template, sections)
     SELECT id, current_form_version, template, sections
       FROM applications
      WHERE id = $1
     ON CONFLICT (application_id, version) DO NOTHING
     RETURNING id`,
    [applicationId],
  );
  if (rows[0]?.id != null) return rows[0].id;

  const { rows: afterConflict } = await pool.query(
    `SELECT fv.id
       FROM application_form_versions fv
       JOIN applications a ON a.id = fv.application_id
      WHERE fv.application_id = $1
        AND fv.version = a.current_form_version
      LIMIT 1`,
    [applicationId],
  );
  if (afterConflict[0]?.id == null) {
    throw new Error(`Expected application ${applicationId} before creating its form snapshot`);
  }
  return afterConflict[0].id;
}

/** Auth header for app.inject() — resolved by the test-mode auth context. */
export function asUser(userId: number): Record<string, string> {
  return { "x-test-user-id": String(userId) };
}

/** Build the app once for a suite; caller closes it in afterAll. */
export async function buildTestApp(): Promise<App> {
  const { buildApp } = await import("../src/app.js");
  return buildApp();
}
