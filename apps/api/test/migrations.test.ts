import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  LEGACY_MIGRATION_RENAMES,
  migrate,
  migrationChecksum,
  validateMigrationFilenames,
} from "../scripts/migrate.js";
import { TEST_DATABASE_URL } from "./test-env.js";

const databaseName = `hackos_migrations_${process.pid}_${randomUUID().replaceAll("-", "")}`;
const databaseUrl = new URL(TEST_DATABASE_URL);
databaseUrl.pathname = `/${databaseName}`;
const adminUrl = new URL(TEST_DATABASE_URL);
adminUrl.pathname = "/postgres";

beforeAll(async () => {
  const adminClient = new pg.Client({ connectionString: adminUrl.toString() });
  await adminClient.connect();
  try {
    await adminClient.query(`CREATE DATABASE "${databaseName}"`);
  } finally {
    await adminClient.end();
  }
});

/** Rejects if `fn` doesn't settle within `ms` — used to bound one drop attempt
 *  so a stuck connect()/query() can be abandoned and retried instead of
 *  silently eating the whole hookTimeout budget on a single try. */
function withTimeout<T>(fn: () => Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    fn().then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

afterAll(async () => {
  // Do not reuse the setup connection after the migration suite has spent
  // several minutes running alongside every other integration file. A fresh
  // admin session avoids teardown hanging on a stale idle socket in CI (H53).
  // Each attempt is time-boxed so one stuck connect()/query() gets abandoned
  // and retried within the overall hookTimeout, instead of a single stall
  // failing the whole suite (two observed CI timeouts here).
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const adminClient = new pg.Client({ connectionString: adminUrl.toString() });
    try {
      await withTimeout(async () => {
        await adminClient.connect();
        // The server may commit the drop while the client loses the response;
        // retries must therefore tolerate a database that is already gone.
        await adminClient.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
      }, 20_000);
      return;
    } catch (err) {
      lastErr = err;
    } finally {
      void adminClient.end().catch(() => {});
    }
  }
  throw lastErr;
});

async function withMigrationClient<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: databaseUrl.toString() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

describe("migration history (H53)", () => {
  it("serializes concurrent first applies and records a checksum for every file", async () => {
    const results = await Promise.all([
      migrate(databaseUrl.toString()),
      migrate(databaseUrl.toString()),
    ]);
    expect(results.filter((result) => result.length > 0)).toHaveLength(1);
    const applied = results.flat();
    expect(applied.length).toBeGreaterThan(0);

    const checksums = await withMigrationClient((client) =>
      client.query<{ checksum: string }>("SELECT checksum FROM _migrations ORDER BY name"),
    );
    expect(checksums.rows).toHaveLength(applied.length);
    expect(checksums.rows.every(({ checksum }) => /^[0-9a-f]{64}$/.test(checksum))).toBe(true);
  });

  it("installs the squashed H54 schema and guards its final invariants", async () => {
    const migrationNames = (
      await readdir(join(dirname(fileURLToPath(import.meta.url)), "..", "db", "migrations"))
    )
      .filter((name) => name.endsWith(".sql"))
      .sort();
    expect(migrationNames.filter((name) => /^07(?:3[1-9]|4[0-6])_/.test(name))).toEqual([]);

    const shape = await withMigrationClient(async (client) => {
      const tables = await client.query<{ name: string | null }>(
        `SELECT to_regclass(name) AS name
           FROM unnest($1::text[]) AS names(name)`,
        [
          [
            "public.anonymous_participants",
            "public.anonymous_participant_fields",
            "public.application_form_versions",
            "public.scanner_revoked_badges",
            "public.scanner_revoked_tickets",
          ],
        ],
      );
      const responseVersion = await client.query<{ not_null: boolean }>(
        `SELECT a.attnotnull AS not_null
           FROM pg_attribute a
           JOIN pg_class c ON c.oid = a.attrelid
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relname = 'application_responses'
            AND a.attname = 'application_form_version_id'`,
      );
      const queueHistoryActor = await client.query<{ not_null: boolean }>(
        `SELECT a.attnotnull AS not_null
           FROM pg_attribute a
           JOIN pg_class c ON c.oid = a.attrelid
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relname = 'queue_history'
            AND a.attname = 'actor_id'`,
      );
      const mealBatchMarker = await client.query<{ not_null: boolean }>(
        `SELECT a.attnotnull AS not_null
           FROM pg_attribute a
           JOIN pg_class c ON c.oid = a.attrelid
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relname = 'meal_scan_batches'
            AND a.attname = 'is_test_account'`,
      );
      const checks = await client.query<{ conname: string }>(
        `SELECT conname
           FROM pg_constraint
          WHERE conname IN ('time_logs_kind_check', 'users_badge_assignment_timestamp_check')`,
      );
      const triggers = await client.query<{ tgname: string; relname: string }>(
        `SELECT t.tgname, c.relname
           FROM pg_trigger t
           JOIN pg_class c ON c.oid = t.tgrelid
          WHERE NOT t.tgisinternal
            AND t.tgname IN ('h54_active_user_user_id', 'h54_active_user_scanned_by',
                             'h54_application_form_version_immutable')`,
      );
      const digestColumns = await client.query<{ relname: string; typname: string }>(
        `SELECT c.relname, format_type(a.atttypid, a.atttypmod) AS typname
           FROM pg_attribute a
           JOIN pg_class c ON c.oid = a.attrelid
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public'
            AND c.relname IN ('scanner_revoked_badges', 'scanner_revoked_tickets')
            AND a.attname = 'credential_digest'`,
      );
      return {
        tables,
        responseVersion,
        queueHistoryActor,
        mealBatchMarker,
        checks,
        triggers,
        digestColumns,
      };
    });

    expect(shape.tables.rows.map((row) => row.name)).toEqual([
      "anonymous_participants",
      "anonymous_participant_fields",
      "application_form_versions",
      "scanner_revoked_badges",
      "scanner_revoked_tickets",
    ]);
    expect(shape.responseVersion.rows).toEqual([{ not_null: true }]);
    expect(shape.queueHistoryActor.rows).toEqual([{ not_null: false }]);
    expect(shape.mealBatchMarker.rows).toEqual([{ not_null: true }]);
    expect(shape.checks.rows.map((row) => row.conname).sort()).toEqual([
      "time_logs_kind_check",
      "users_badge_assignment_timestamp_check",
    ]);
    const triggerNames = shape.triggers.rows.map((row) => `${row.relname}.${row.tgname}`);
    expect(triggerNames).toEqual(
      expect.arrayContaining([
        "application_form_versions.h54_application_form_version_immutable",
        "sessions.h54_active_user_user_id",
        "time_logs.h54_active_user_scanned_by",
        "time_logs.h54_active_user_user_id",
      ]),
    );
    expect(shape.digestColumns.rows).toHaveLength(2);
    expect(shape.digestColumns.rows.every((row) => row.typname === "text")).toBe(true);
  });

  it("bounds pending recovery sessions at the fixed anonymization deadline (H54)", async () => {
    await withMigrationClient(async (client) => {
      const { rows: users } = await client.query<{ id: number }>(
        `INSERT INTO users (email, email_verified)
         VALUES ($1, true) RETURNING id`,
        [`pending-session-trigger-${randomUUID()}@test.local`],
      );
      const userId = users[0]?.id;
      if (userId == null) throw new Error("Expected pending-session test user");

      await client.query(
        `UPDATE users
            SET account_state = 'removal_pending',
                removal_action = 'anonymize',
                removal_requires_exit = true,
                removal_expires_at = clock_timestamp() + interval '1 hour'
          WHERE id = $1`,
        [userId],
      );

      const token = `pending-session-${randomUUID()}`;
      await client.query(
        `INSERT INTO sessions (user_id, token, expires_at)
         VALUES ($1, $2, clock_timestamp() + interval '30 minutes')`,
        [userId, token],
      );
      await expect(
        client.query(
          `INSERT INTO sessions (user_id, token, expires_at)
           VALUES ($1, $2, clock_timestamp() + interval '2 hours')`,
          [userId, `over-deadline-${randomUUID()}`],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        client.query(
          `UPDATE sessions
              SET expires_at = clock_timestamp() + interval '2 hours'
            WHERE token = $1`,
          [token],
        ),
      ).rejects.toMatchObject({ code: "23514" });

      await client.query(`UPDATE users SET removal_action = 'delete' WHERE id = $1`, [userId]);
      await expect(
        client.query(
          `INSERT INTO sessions (user_id, token, expires_at)
           VALUES ($1, $2, clock_timestamp() + interval '30 minutes')`,
          [userId, `delete-pending-${randomUUID()}`],
        ),
      ).rejects.toMatchObject({ code: "23514" });
    });
  });

  it("requires every response to reference an immutable snapshot from the same application (H54)", async () => {
    await withMigrationClient(async (client) => {
      const { rows: users } = await client.query<{ id: number }>(
        `INSERT INTO users (email, email_verified)
         VALUES ($1, true) RETURNING id`,
        [`form-version-invariant-${randomUUID()}@test.local`],
      );
      const userId = users[0]?.id;
      if (userId == null) throw new Error("Expected invariant test user");

      const { rows: applications } = await client.query<{ id: number }>(
        `INSERT INTO applications (name, type, template)
         VALUES ($1, 'participant', '[]'::jsonb),
                ($2, 'participant', '[]'::jsonb)
         RETURNING id`,
        [`form-version-a-${randomUUID()}`, `form-version-b-${randomUUID()}`],
      );
      const applicationA = applications[0]?.id;
      const applicationB = applications[1]?.id;
      if (applicationA == null || applicationB == null) {
        throw new Error("Expected invariant test applications");
      }

      const { rows: versions } = await client.query<{
        id: string;
        application_id: number;
      }>(
        `INSERT INTO application_form_versions (application_id, version, template, sections)
         VALUES ($1, 1, '[]'::jsonb, '[]'::jsonb),
                ($2, 1, '[]'::jsonb, '[]'::jsonb)
         RETURNING id, application_id`,
        [applicationA, applicationB],
      );
      const versionA = versions.find((version) => version.application_id === applicationA)?.id;
      if (versionA == null) throw new Error("Expected application A form snapshot");

      // Keep this direct SQL: it deliberately verifies H54's database NOT
      // NULL boundary rather than exercising a production/helper path.
      await expect(
        client.query(
          `INSERT INTO application_responses (user_id, application_id, status)
           VALUES ($1, $2, 'review')`,
          [userId, applicationA],
        ),
      ).rejects.toMatchObject({ code: "23502" });

      // The single-column FK accepts versionA, but H54's composite FK must
      // reject using application A's snapshot for application B.
      await expect(
        client.query(
          `INSERT INTO application_responses
             (user_id, application_id, application_form_version_id, status)
           VALUES ($1, $2, $3, 'review')`,
          [userId, applicationB, versionA],
        ),
      ).rejects.toMatchObject({ code: "23503" });

      await client.query(
        `INSERT INTO application_responses
           (user_id, application_id, application_form_version_id, status)
         VALUES ($1, $2, $3, 'review')`,
        [userId, applicationA, versionA],
      );
      const { rows: bound } = await client.query(
        `SELECT response.application_id, version.application_id AS version_application_id
           FROM application_responses response
           JOIN application_form_versions version
             ON version.id = response.application_form_version_id
          WHERE response.user_id = $1`,
        [userId],
      );
      expect(bound).toEqual([
        { application_id: applicationA, version_application_id: applicationA },
      ]);
    });
  });

  it("is a no-op after the first apply", async () => {
    await expect(migrate(databaseUrl.toString())).resolves.toEqual([]);
  });

  it("backfills the checksum column on a pre-checksum ledger", async () => {
    await withMigrationClient((client) =>
      client.query("ALTER TABLE _migrations DROP COLUMN checksum"),
    );

    await expect(migrate(databaseUrl.toString())).resolves.toEqual([]);
    const result = await withMigrationClient((client) =>
      client.query<{ checksum: string }>("SELECT checksum FROM _migrations WHERE name = $1", [
        "0001_initial.sql",
      ]),
    );
    expect(result.rows[0]?.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it("fails before applying anything when an applied checksum changes", async () => {
    const original = await withMigrationClient((client) =>
      client.query<{ checksum: string }>("SELECT checksum FROM _migrations WHERE name = $1", [
        "0001_initial.sql",
      ]),
    );
    await withMigrationClient((client) =>
      client.query("UPDATE _migrations SET checksum = $1 WHERE name = $2", [
        "deadbeef",
        "0001_initial.sql",
      ]),
    );

    await expect(migrate(databaseUrl.toString())).rejects.toThrow(
      /Migration checksum mismatch for "0001_initial\.sql"/,
    );
    await withMigrationClient((client) =>
      client.query("UPDATE _migrations SET checksum = $1 WHERE name = $2", [
        original.rows[0]?.checksum,
        "0001_initial.sql",
      ]),
    );
  });

  it("recognizes every old name in a renumbered production ledger", async () => {
    const renames = Object.entries(LEGACY_MIGRATION_RENAMES);
    expect(renames).toHaveLength(24);
    await withMigrationClient(async (client) => {
      await client.query("BEGIN");
      await client.query("ALTER TABLE _migrations DROP COLUMN checksum");
      for (const [oldName, currentName] of renames) {
        await client.query("UPDATE _migrations SET name = $1 WHERE name = $2", [
          oldName,
          currentName,
        ]);
      }
      await client.query("COMMIT");
    });

    await expect(migrate(databaseUrl.toString())).resolves.toEqual([]);
    const checksums = await withMigrationClient((client) =>
      client.query<{ checksum: string }>("SELECT checksum FROM _migrations"),
    );
    expect(checksums.rows.every(({ checksum }) => /^[0-9a-f]{64}$/.test(checksum))).toBe(true);
  });

  it("rejects duplicate numeric prefixes", () => {
    expect(() => validateMigrationFilenames(["0701_a.sql", "0701_b.sql"])).toThrow(
      /Duplicate migration sequence 0701/,
    );
  });

  it("uses a deterministic SHA-256 checksum", () => {
    expect(migrationChecksum("select 1;")).toBe(
      "354b7196c9ba5fb4b21cf615bb6ec4cd5c07503c34229feef033fc081a8c03f4",
    );
    expect(migrationChecksum("select 1;")).toBe(migrationChecksum("select 1;"));
    expect(migrationChecksum("select 1;")).not.toBe(migrationChecksum("select 2;"));
  });
});
