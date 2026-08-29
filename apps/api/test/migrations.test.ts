import { createHmac, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  LEGACY_H54_MIGRATION_NAMES,
  LEGACY_MIGRATION_RENAMES,
  migrate,
  migrationChecksum,
  validateMigrationFilenames,
} from "../scripts/migrate.js";
import { TEST_DATABASE_URL } from "./test-env.js";

const databaseName = `hackos_migrations_${process.pid}_${randomUUID().replaceAll("-", "")}`;
const upgradeDatabaseName = `hackos_migrations_upgrade_${process.pid}_${randomUUID().replaceAll("-", "")}`;
const collisionDatabaseName = `hackos_migrations_collision_${process.pid}_${randomUUID().replaceAll("-", "")}`;
const legacyDatabaseName = `hackos_migrations_legacy_${process.pid}_${randomUUID().replaceAll("-", "")}`;
const databaseUrl = new URL(TEST_DATABASE_URL);
databaseUrl.pathname = `/${databaseName}`;
const upgradeDatabaseUrl = new URL(TEST_DATABASE_URL);
upgradeDatabaseUrl.pathname = `/${upgradeDatabaseName}`;
const collisionDatabaseUrl = new URL(TEST_DATABASE_URL);
collisionDatabaseUrl.pathname = `/${collisionDatabaseName}`;
const legacyDatabaseUrl = new URL(TEST_DATABASE_URL);
legacyDatabaseUrl.pathname = `/${legacyDatabaseName}`;
const adminUrl = new URL(TEST_DATABASE_URL);
adminUrl.pathname = "/postgres";

beforeAll(async () => {
  const adminClient = new pg.Client({ connectionString: adminUrl.toString() });
  await adminClient.connect();
  try {
    await adminClient.query(`CREATE DATABASE "${databaseName}"`);
    await adminClient.query(`CREATE DATABASE "${upgradeDatabaseName}"`);
    await adminClient.query(`CREATE DATABASE "${collisionDatabaseName}"`);
    await adminClient.query(`CREATE DATABASE "${legacyDatabaseName}"`);
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
        await adminClient.query(`DROP DATABASE IF EXISTS "${upgradeDatabaseName}" WITH (FORCE)`);
        await adminClient.query(`DROP DATABASE IF EXISTS "${collisionDatabaseName}" WITH (FORCE)`);
        await adminClient.query(`DROP DATABASE IF EXISTS "${legacyDatabaseName}" WITH (FORCE)`);
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

async function withUpgradeClient<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: upgradeDatabaseUrl.toString() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function withCollisionClient<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: collisionDatabaseUrl.toString() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function withLegacyClient<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: legacyDatabaseUrl.toString() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function installMainSchema(client: pg.Client): Promise<void> {
  const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "db", "migrations");
  const migrationNames = (await readdir(migrationsDir))
    .filter((name) => name.endsWith(".sql") && name < "0730_account_deletion_anonymization.sql")
    .sort();
  await client.query(
    `CREATE TABLE _migrations (
       name text PRIMARY KEY,
       applied_at timestamptz NOT NULL DEFAULT now(),
       checksum text NOT NULL
     )`,
  );
  for (const name of migrationNames) {
    const sql = await readFile(join(migrationsDir, name), "utf8");
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("INSERT INTO _migrations (name, checksum) VALUES ($1, $2)", [
        name,
        migrationChecksum(sql),
      ]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
}

/** Recreates the shape left by the pre-squash 0730 before its follow-ups. */
async function installLegacyH54Shape(client: pg.Client): Promise<void> {
  await installMainSchema(client);
  await client.query("BEGIN");
  try {
    await client.query(`
      ALTER TABLE users
        ADD COLUMN account_state text NOT NULL DEFAULT 'active'
          CHECK (account_state IN ('active', 'removal_pending')),
        ADD COLUMN removal_action text
          CHECK (removal_action IS NULL OR removal_action IN ('delete', 'anonymize')),
        ADD COLUMN removal_started_at timestamptz;

      CREATE TABLE anonymous_participants (
        id uuid PRIMARY KEY,
        age integer CHECK (age IS NULL OR age BETWEEN 0 AND 150),
        gender text,
        university text,
        degree text,
        graduation_year smallint CHECK (
          graduation_year IS NULL OR graduation_year BETWEEN 1900 AND 2200
        ),
        origin_city text,
        guaranteed_presence_minutes integer NOT NULL DEFAULT 0
          CHECK (guaranteed_presence_minutes >= 0),
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE scanner_revoked_badges (
        badge_id text PRIMARY KEY,
        revoked_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NOT NULL
      );
      CREATE TABLE scanner_revoked_tickets (
        ticket_token text PRIMARY KEY,
        revoked_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NOT NULL
      );

      ALTER TABLE check_in_logs
        ALTER COLUMN user_id DROP NOT NULL,
        ALTER COLUMN staff_id DROP NOT NULL,
        ADD COLUMN anonymous_participant_id uuid REFERENCES anonymous_participants(id);
      ALTER TABLE time_logs
        ALTER COLUMN user_id DROP NOT NULL,
        ADD COLUMN anonymous_participant_id uuid REFERENCES anonymous_participants(id);
      ALTER TABLE meal_scan_batches ALTER COLUMN submitted_by DROP NOT NULL;
      ALTER TABLE data_subject_requests
        ALTER COLUMN subject_user_id DROP NOT NULL,
        ALTER COLUMN requested_by DROP NOT NULL;
      ALTER TABLE universities ALTER COLUMN proposed_by DROP NOT NULL;
      ALTER TABLE food_intolerances ALTER COLUMN proposed_by DROP NOT NULL;
      ALTER TABLE queue_history ALTER COLUMN actor_id DROP NOT NULL;
      ALTER TABLE attempt_review_versions ALTER COLUMN author_id DROP NOT NULL;
      ALTER TABLE judging_session ALTER COLUMN judge_id DROP NOT NULL;
      ALTER TABLE announcements ALTER COLUMN author_id DROP NOT NULL;
      ALTER TABLE activity_logs ALTER COLUMN logged_by DROP NOT NULL;
      ALTER TABLE challenge_winners ALTER COLUMN set_by DROP NOT NULL;
      ALTER TABLE meal_scan_batch_items ALTER COLUMN badge_id DROP NOT NULL;
      ALTER TABLE check_in_logs ADD CONSTRAINT check_in_logs_subject_check
        CHECK ((user_id IS NULL) <> (anonymous_participant_id IS NULL));
      ALTER TABLE time_logs ADD CONSTRAINT time_logs_subject_check
        CHECK ((user_id IS NULL) <> (anonymous_participant_id IS NULL));
    `);
    const anonymousId = randomUUID();
    await client.query(
      `INSERT INTO anonymous_participants
         (id, age, gender, university, degree, graduation_year, origin_city, guaranteed_presence_minutes)
       VALUES ($1, 29, 'non-binary', 'Universidade', 'Computer Science', 2024, 'A Coruña', 42)`,
      [anonymousId],
    );
    await client.query(
      `INSERT INTO scanner_revoked_badges (badge_id, expires_at)
       VALUES ('legacy-compat-badge', clock_timestamp() + interval '1 day')`,
    );
    await client.query(
      `INSERT INTO scanner_revoked_tickets (ticket_token, expires_at)
       VALUES ('legacy-compat-ticket', clock_timestamp() + interval '1 day')`,
    );
    const { rows: users } = await client.query<{ id: number }>(
      `INSERT INTO users (email, email_verified)
       VALUES ($1, true) RETURNING id`,
      [`legacy-compat-user-${randomUUID()}@test.local`],
    );
    const userId = users[0]?.id;
    if (userId == null) throw new Error("Expected legacy compatibility user");
    const { rows: applications } = await client.query<{ id: number }>(
      `INSERT INTO applications (name, type, template)
       VALUES ($1, 'participant', '[]'::jsonb) RETURNING id`,
      [`legacy-compat-form-${randomUUID()}`],
    );
    const applicationId = applications[0]?.id;
    if (applicationId == null) throw new Error("Expected legacy compatibility application");
    await client.query(
      `INSERT INTO application_responses (user_id, application_id, status)
       VALUES ($1, $2, 'submitted')`,
      [userId, applicationId],
    );
    await client.query("ALTER TABLE _migrations ALTER COLUMN checksum DROP NOT NULL");
    for (const [index, name] of [
      "0730_account_deletion_anonymization.sql",
      ...LEGACY_H54_MIGRATION_NAMES,
    ].entries()) {
      await client.query("INSERT INTO _migrations (name, checksum) VALUES ($1, $2)", [
        name,
        index === 1 ? null : "0".repeat(64),
      ]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
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

  it("upgrades a populated latest-main database in place", async () => {
    const secret = process.env.BETTER_AUTH_SECRET ?? "dev-only-secret-change-me";
    await withUpgradeClient(async (client) => {
      await installMainSchema(client);

      const { rows: activeUsers } = await client.query<{ id: number }>(
        `INSERT INTO users (email, email_verified)
         VALUES ($1, true) RETURNING id`,
        [`main-upgrade-active-${randomUUID()}@test.local`],
      );
      const activeUserId = activeUsers[0]?.id;
      if (activeUserId == null) throw new Error("Expected active upgrade user");

      const legacyEmail = `main-upgrade-legacy-${randomUUID()}@test.local`;
      const { rows: legacyUsers } = await client.query<{ id: number }>(
        `INSERT INTO users
           (email, email_verified, badge_id, badge_id_history, anonymized_at)
         VALUES ($1, true, 'legacy-badge-current', ARRAY['legacy-badge-old']::text[], now())
         RETURNING id`,
        [legacyEmail],
      );
      const legacyUserId = legacyUsers[0]?.id;
      if (legacyUserId == null) throw new Error("Expected legacy upgrade user");

      const { rows: devpostOnlyRepos } = await client.query<{ id: number }>(
        `INSERT INTO repos (name, source)
         VALUES ($1, 'devpost') RETURNING id`,
        [`main-upgrade-devpost-only-${randomUUID()}`],
      );
      const devpostOnlyRepoId = devpostOnlyRepos[0]?.id;
      if (devpostOnlyRepoId == null) throw new Error("Expected Devpost-only repository");
      await client.query(
        `INSERT INTO devpost_participants
           (repo_id, email, name, import_batch, user_id)
         VALUES ($1, $2, 'Legacy', 'migration-test', $3)`,
        [devpostOnlyRepoId, legacyEmail, legacyUserId],
      );

      const inAt = new Date("2026-08-29T08:00:00.000Z");
      const outAt = new Date("2026-08-29T08:30:00.000Z");
      await client.query(
        `INSERT INTO time_logs (user_id, kind, scanned_at, scanned_by)
         VALUES ($1, 'in', $2, $3), ($1, 'out', $4, $3)`,
        [legacyUserId, inAt, activeUserId, outAt],
      );
      await client.query(
        `INSERT INTO check_in_logs (user_id, badge_id, staff_id)
         VALUES ($1, 'legacy-badge-current', $2)`,
        [legacyUserId, activeUserId],
      );
      await client.query(
        `INSERT INTO tickets (user_id, token) VALUES ($1, 'legacy-ticket-token')`,
        [legacyUserId],
      );
      await client.query(
        `INSERT INTO applications (name, type, template)
         VALUES ($1, 'participant', '{"fields":[]}'::jsonb)`,
        [`main-upgrade-form-${randomUUID()}`],
      );
      const { rows: applications } = await client.query<{ id: number }>(
        `SELECT id FROM applications ORDER BY id DESC LIMIT 1`,
      );
      const applicationId = applications[0]?.id;
      if (applicationId == null) throw new Error("Expected upgrade application");
      await client.query(
        `INSERT INTO application_responses (user_id, application_id, status)
         VALUES ($1, $2, 'submitted'), ($3, $2, 'submitted')`,
        [activeUserId, applicationId, legacyUserId],
      );
      await client.query(
        `INSERT INTO email_verification_tokens (token, type, email, user_id, expires_at)
         VALUES ('legacy-upgrade-token', 'primary_email', $1, $2, now() + interval '1 hour')`,
        [legacyEmail, legacyUserId],
      );
      await client.query(
        `INSERT INTO verifications (identifier, value, expires_at)
         VALUES ($1, 'legacy-value', now() + interval '1 hour')`,
        [legacyEmail],
      );
      const detachedVerificationEmail = `detached-legacy-${randomUUID()}@test.local`;
      await client.query(
        `INSERT INTO verifications (identifier, value, expires_at)
         VALUES ($1, 'detached-legacy-value', now() + interval '1 hour')`,
        [detachedVerificationEmail],
      );
      await client.query(
        `INSERT INTO data_subject_requests
           (subject_user_id, requested_by, type)
         VALUES ($1, $1, 'deletion')`,
        [legacyUserId],
      );
      await client.query(
        `INSERT INTO audit_log (actor_id, entity_type, entity_id, action, before)
         VALUES ($1, 'user', $2, 'legacy', jsonb_build_object('email', $3::text))`,
        [legacyUserId, String(legacyUserId), legacyEmail],
      );

      await expect(migrate(upgradeDatabaseUrl.toString())).resolves.toContain(
        "0730_account_deletion_anonymization.sql",
      );

      const state = await client.query<{
        active_users: string;
        legacy_users: string;
        anonymous_subjects: string;
        guaranteed_minutes: string;
        revoked_badges: string;
        revoked_tickets: string;
        legacy_checkins: string;
        legacy_time_logs: string;
        legacy_responses: string;
        active_response_version: string;
        legacy_tokens: string;
        legacy_verifications: string;
        detached_verifications: string;
        devpost_only_repos: string;
        legacy_requests: string;
        legacy_audit: string;
      }>(
        `SELECT
           (SELECT count(*) FROM users WHERE id = $1)::text AS active_users,
           (SELECT count(*) FROM users WHERE id = $2)::text AS legacy_users,
           (SELECT count(*) FROM anonymous_participants)::text AS anonymous_subjects,
           (SELECT COALESCE(sum(guaranteed_presence_minutes), 0) FROM anonymous_participants) AS guaranteed_minutes,
           (SELECT count(*) FROM scanner_revoked_badges)::text AS revoked_badges,
           (SELECT count(*) FROM scanner_revoked_tickets)::text AS revoked_tickets,
           (SELECT count(*) FROM check_in_logs WHERE user_id = $2)::text AS legacy_checkins,
           (SELECT count(*) FROM time_logs WHERE user_id = $2)::text AS legacy_time_logs,
           (SELECT count(*) FROM application_responses WHERE user_id = $2)::text AS legacy_responses,
           (SELECT count(*) FROM application_responses WHERE user_id = $1 AND application_form_version_id IS NOT NULL)::text AS active_response_version,
           (SELECT count(*) FROM email_verification_tokens WHERE user_id = $2)::text AS legacy_tokens,
           (SELECT count(*) FROM verifications WHERE identifier = $3)::text AS legacy_verifications,
           (SELECT count(*) FROM verifications WHERE identifier = $4)::text AS detached_verifications,
           (SELECT count(*) FROM repos WHERE id = $5)::text AS devpost_only_repos,
           (SELECT count(*) FROM data_subject_requests WHERE subject_user_id = $2 OR requested_by = $2)::text AS legacy_requests,
           (SELECT count(*) FROM audit_log WHERE actor_id = $2)::text AS legacy_audit`,
        [activeUserId, legacyUserId, legacyEmail, detachedVerificationEmail, devpostOnlyRepoId],
      );
      expect(state.rows[0]).toEqual({
        active_users: "1",
        legacy_users: "0",
        anonymous_subjects: "1",
        guaranteed_minutes: "30",
        revoked_badges: "2",
        revoked_tickets: "1",
        legacy_checkins: "0",
        legacy_time_logs: "0",
        legacy_responses: "0",
        active_response_version: "1",
        legacy_tokens: "0",
        legacy_verifications: "0",
        detached_verifications: "0",
        devpost_only_repos: "0",
        legacy_requests: "0",
        legacy_audit: "0",
      });

      const expectedBadgeDigest = createHmac("sha256", secret)
        .update("hackos:scanner-credential:v1:badge:legacy-badge-current")
        .digest("hex");
      const expectedTicketDigest = createHmac("sha256", secret)
        .update("hackos:scanner-credential:v1:ticket:legacy-ticket-token")
        .digest("hex");
      const digests = await client.query<{ credential_digest: string }>(
        `SELECT credential_digest
           FROM scanner_revoked_badges
          WHERE credential_digest = $1
         UNION ALL
         SELECT credential_digest
           FROM scanner_revoked_tickets
          WHERE credential_digest = $2`,
        [expectedBadgeDigest, expectedTicketDigest],
      );
      expect(digests.rows).toHaveLength(2);
    });
  });

  it("normalizes a populated pre-squash H54 ledger without a manual compatibility step", async () => {
    const secret = process.env.BETTER_AUTH_SECRET ?? "dev-only-secret-change-me";
    await withLegacyClient(async (client) => {
      await installLegacyH54Shape(client);

      const applied = await migrate(legacyDatabaseUrl.toString());
      expect(applied).toContain("0747_h54_legacy_chain_compatibility.sql");
      expect(applied).not.toContain("0730_account_deletion_anonymization.sql");

      const columns = await client.query<{ table_name: string; column_name: string }>(
        `SELECT table_name, column_name
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND (
              (table_name = 'anonymous_participants' AND column_name IN ('age', 'gender', 'university', 'degree', 'graduation_year', 'origin_city'))
              OR (table_name = 'scanner_revoked_badges' AND column_name IN ('badge_id', 'expires_at'))
              OR (table_name = 'scanner_revoked_tickets' AND column_name IN ('ticket_token', 'expires_at'))
              OR (table_name = 'check_in_logs' AND column_name = 'anonymous_participant_id')
              OR (table_name = 'time_logs' AND column_name = 'anonymous_participant_id')
            )
          ORDER BY table_name, column_name`,
      );
      expect(columns.rows).toEqual([]);

      const state = await client.query<{
        anonymous_fields: string;
        badge_digests: string;
        ticket_digests: string;
        response_versions: string;
        meal_marker_not_null: boolean;
        compatibility_ledger: string;
      }>(
        `SELECT
           (SELECT count(*) FROM anonymous_participant_fields
             WHERE field_key IN ('age', 'gender', 'university', 'degree', 'graduation_year', 'origin_city'))::text AS anonymous_fields,
           (SELECT count(*) FROM scanner_revoked_badges)::text AS badge_digests,
           (SELECT count(*) FROM scanner_revoked_tickets)::text AS ticket_digests,
           (SELECT count(*) FROM application_responses WHERE application_form_version_id IS NOT NULL)::text AS response_versions,
           (SELECT attnotnull FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
             WHERE c.relname = 'meal_scan_batches' AND a.attname = 'is_test_account') AS meal_marker_not_null,
           (SELECT count(*) FROM _migrations WHERE name = '0747_h54_legacy_chain_compatibility.sql')::text AS compatibility_ledger`,
      );
      expect(state.rows[0]).toEqual({
        anonymous_fields: "6",
        badge_digests: "1",
        ticket_digests: "1",
        response_versions: "1",
        meal_marker_not_null: true,
        compatibility_ledger: "1",
      });

      const expectedBadgeDigest = createHmac("sha256", secret)
        .update("hackos:scanner-credential:v1:badge:legacy-compat-badge")
        .digest("hex");
      const expectedTicketDigest = createHmac("sha256", secret)
        .update("hackos:scanner-credential:v1:ticket:legacy-compat-ticket")
        .digest("hex");
      const digests = await client.query<{ credential_digest: string }>(
        `SELECT credential_digest FROM scanner_revoked_badges
          WHERE credential_digest = $1
         UNION ALL
         SELECT credential_digest FROM scanner_revoked_tickets
          WHERE credential_digest = $2`,
        [expectedBadgeDigest, expectedTicketDigest],
      );
      expect(digests.rows).toHaveLength(2);

      await expect(migrate(legacyDatabaseUrl.toString())).resolves.toEqual([]);
    });
  });

  it("rejects a legacy badge history value that is assigned to an active user", async () => {
    await withCollisionClient(async (client) => {
      await installMainSchema(client);
      await client.query(
        `INSERT INTO users (email, email_verified, badge_id)
         VALUES ($1, true, 'reused-legacy-badge')`,
        [`active-badge-owner-${randomUUID()}@test.local`],
      );
      await client.query(
        `INSERT INTO users (email, email_verified, badge_id_history, anonymized_at)
         VALUES ($1, true, ARRAY['reused-legacy-badge']::text[], now())`,
        [`legacy-badge-owner-${randomUUID()}@test.local`],
      );

      await expect(migrate(collisionDatabaseUrl.toString())).rejects.toThrow(
        /currently assigned to an active user/,
      );

      const state = await client.query<{ users: string; denylist: string }>(
        `SELECT
           (SELECT count(*) FROM users)::text AS users,
           (SELECT count(*) FROM pg_catalog.pg_class WHERE relname = 'scanner_revoked_badges')::text AS denylist`,
      );
      expect(state.rows[0]).toEqual({ users: "2", denylist: "0" });
    });
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

      const { rows: activeUsers } = await client.query<{ id: number }>(
        `INSERT INTO users (email, email_verified)
         VALUES ($1, true) RETURNING id`,
        [`active-session-owner-${randomUUID()}@test.local`],
      );
      const activeUserId = activeUsers[0]?.id;
      if (activeUserId == null) throw new Error("Expected active session owner");
      const activeToken = `active-session-${randomUUID()}`;
      await client.query(
        `INSERT INTO sessions (user_id, token, expires_at)
         VALUES ($1, $2, clock_timestamp() + interval '30 minutes')`,
        [activeUserId, activeToken],
      );
      await expect(
        client.query(`UPDATE sessions SET user_id = $1 WHERE token = $2`, [userId, activeToken]),
      ).rejects.toMatchObject({ code: "23514" });

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
