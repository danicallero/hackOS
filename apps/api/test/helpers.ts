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
  // The GET read cache keys on the URL, and RESTART IDENTITY hands the next
  // test the same ids — so without this a cached body from the previous test
  // replays for a completely different row. Invalidated here rather than in
  // each suite because every direct-SQL seed has the problem.
  const { invalidateReadCache } = await import("../src/lib/read-cache.js");
  await invalidateReadCache();
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

/** Auth header for app.inject() — resolved by the test-mode auth context. */
export function asUser(userId: number): Record<string, string> {
  return { "x-test-user-id": String(userId) };
}

/** Build the app once for a suite; caller closes it in afterAll. */
export async function buildTestApp(): Promise<App> {
  const { buildApp } = await import("../src/app.js");
  return buildApp();
}
