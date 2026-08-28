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

/** Create a user holding the given capabilities (via a throwaway group). */
export async function createUserWithCapabilities(capabilities: string[]): Promise<number> {
  const userId = await createUser();
  const group = await pool.query(`INSERT INTO permission_groups (name) VALUES ($1) RETURNING id`, [
    `test-group-${crypto.randomUUID()}`,
  ]);
  const groupId = group.rows[0].id;
  for (const cap of capabilities) {
    await pool.query(`INSERT INTO group_capabilities (group_id, capability) VALUES ($1, $2)`, [
      groupId,
      cap,
    ]);
  }
  await pool.query(`INSERT INTO permission_group_members (user_id, group_id) VALUES ($1, $2)`, [
    userId,
    groupId,
  ]);
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
