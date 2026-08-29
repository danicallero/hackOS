/**
 * SQL migration runner. Applies db/migrations/*.sql in lexicographic order,
 * each inside its own transaction, recording applied files in _migrations.
 * A Postgres advisory lock serializes concurrent runners (e.g. two dev
 * processes or several test workers booting at once).
 *
 * Numbering bands per workstream (see CLAUDE.md): 0001-0099 foundation,
 * 01xx identity, 02xx applications, 03xx projects/devpost, 04xx queue,
 * 05xx logistics, 06xx notifications, 07xx sponsors/content.
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { DEFAULT_DATABASE_URL } from "./default-database-url.js";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "db", "migrations");
const ADVISORY_LOCK_KEY = 815_001;
const MIGRATION_AUTH_SECRET_GUC = "hackos.better_auth_secret";
const DEFAULT_AUTH_SECRET = "dev-only-secret-change-me";
const H54_BASELINE_MIGRATION = "0730_account_deletion_anonymization.sql";
const H54_LEGACY_COMPAT_MIGRATION = "0747_h54_legacy_chain_compatibility.sql";

/**
 * H54 was developed as a sequence of migrations before it was squashed into
 * 0730. These names are historical ledger entries, not aliases to current
 * files: the compatibility migration normalizes their already-applied schema.
 */
export const LEGACY_H54_MIGRATION_NAMES = Object.freeze([
  "0731_account_removal_scanner_tombstones.sql",
  "0732_account_removal_meal_inbox.sql",
  "0733_account_removal_reference_guards.sql",
  "0734_account_removal_minimization.sql",
  "0735_schema_driven_anonymous_retention.sql",
  "0736_account_removal_pending_exit.sql",
  "0737_permanent_scanner_credential_tombstones.sql",
  "0738_application_response_form_version_integrity.sql",
  "0739_pending_exit_event_close.sql",
  "0740_account_removal_email_pin.sql",
  "0741_keyed_scanner_credential_tombstones.sql",
  "0742_account_removal_pending_recovery.sql",
  "0743_review_fixture_accounts.sql",
  "0744_review_fixture_queues.sql",
  "0745_badge_assignment_timestamp.sql",
  "0746_permanent_scanner_tombstones.sql",
] as const);
const LEGACY_H54_MIGRATION_NAME_SET = new Set<string>(LEGACY_H54_MIGRATION_NAMES);

// These are the checksums of the pre-squash 0730 file in the commits that
// shipped the historical chain. The current 0730 checksum is intentionally
// not listed; its normal checksum validation must remain strict.
const LEGACY_H54_BASELINE_CHECKSUMS = new Set([
  "0135c0855974a0947571c223419c6c384d0aab552c815b6f938c4cc1534bd754",
  "c34950dd2be110c80df5adce504e07e363c721357c36c7591844d93db0aef49f",
  "2efab5b1d3a05af2daebc8653966d5dfd3355906ce04e00ab5f534a885fb0407",
  "f8d47272325bd865a074c7611876ee18d6f786d5b07aafd2ac7eb47ff0a8ea64",
  "800b1eed3be5ecc80868faee207f79824706bb79378d8b5077e46113a46ef384",
  "7180641cecdbb41b193a309deacba17600189d81c32b48094904bc15f7f1e9cd",
  "125e5103a0f0cddb202ffe8e543ba069ffe2ad96d677c4ca87476862d8209544",
  "af38a636dec067e3e445694cde65785cebaf0037ae96f80dc4d107a223da7d0e",
]);

/**
 * Files that were already applied before the 07xx sequence collision was
 * fixed. The SQL content is unchanged; only the filename moved so every
 * active migration has a unique sequence number (H53).
 */
export const LEGACY_MIGRATION_RENAMES: Readonly<Record<string, string>> = Object.freeze({
  "0701_enterprise_visibility.sql": "0702_enterprise_visibility.sql",
  "0702_challenge_i18n.sql": "0703_challenge_i18n.sql",
  "0703_challenge_description_i18n.sql": "0704_challenge_description_i18n.sql",
  "0704_rooms_and_challenge_ui.sql": "0705_rooms_and_challenge_ui.sql",
  "0705_enterprise_negative_logo.sql": "0706_enterprise_negative_logo.sql",
  "0705_new_rooms_start_paused.sql": "0707_new_rooms_start_paused.sql",
  "0706_drop_meal_entitlements.sql": "0708_drop_meal_entitlements.sql",
  "0707_presence_policy.sql": "0709_presence_policy.sql",
  "0708_time_logs_system_actor.sql": "0710_time_logs_system_actor.sql",
  "0709_dietary_data_provenance.sql": "0711_dietary_data_provenance.sql",
  "0710_drop_dietary_removal_on_decline.sql": "0712_drop_dietary_removal_on_decline.sql",
  "0711_challenge_winners.sql": "0713_challenge_winners.sql",
  "0712_sponsor_faq.sql": "0714_sponsor_faq.sql",
  "0713_schedule_audience_owners.sql": "0715_schedule_audience_owners.sql",
  "0714_sponsor_faq_items.sql": "0716_sponsor_faq_items.sql",
  "0715_schedule_notes.sql": "0717_schedule_notes.sql",
  "0716_schedule_drop_checklist.sql": "0718_schedule_drop_checklist.sql",
  "0717_user_ui_prefs.sql": "0719_user_ui_prefs.sql",
  "0718_schedule_audience_rework.sql": "0720_schedule_audience_rework.sql",
  "0719_schedule_owner_free_text.sql": "0721_schedule_owner_free_text.sql",
  "0720_schedule_visibility_requires_audience.sql":
    "0722_schedule_visibility_requires_audience.sql",
  "0721_schedule_visibility_constraint_binds.sql": "0723_schedule_visibility_constraint_binds.sql",
  "0722_announcements_audience_and_recipients.sql":
    "0724_announcements_audience_and_recipients.sql",
  "0723_schedule_activity_i18n.sql": "0725_schedule_activity_i18n.sql",
});

type MigrationFile = {
  name: string;
  sql: string;
  checksum: string;
};

type MigrationRecord = {
  name: string;
  checksum: string | null;
};

export function migrationChecksum(sql: string): string {
  return createHash("sha256").update(sql, "utf8").digest("hex");
}

/** Validate the filename contract before opening a database connection. */
export function validateMigrationFilenames(files: readonly string[]): void {
  const sequences = new Map<string, string>();
  for (const file of files) {
    const match = /^(\d{4})_[A-Za-z0-9][A-Za-z0-9_-]*\.sql$/.exec(file);
    if (!match) {
      throw new Error(
        `Invalid migration filename "${file}". Expected NNNN_description.sql with a four-digit sequence.`,
      );
    }
    const sequence = match[1];
    if (!sequence) {
      throw new Error(`Migration filename "${file}" has no sequence prefix.`);
    }
    const previous = sequences.get(sequence);
    if (previous) {
      throw new Error(
        `Duplicate migration sequence ${sequence}: ${previous} and ${file}. ` +
          "Renumber one migration before applying the bundle.",
      );
    }
    sequences.set(sequence, file);
  }
}

async function readMigrationFiles(): Promise<MigrationFile[]> {
  const names = (await readdir(MIGRATIONS_DIR)).filter((file) => file.endsWith(".sql")).sort();
  validateMigrationFilenames(names);
  return Promise.all(
    names.map(async (name) => {
      const sql = await readFile(join(MIGRATIONS_DIR, name), "utf8");
      return { name, sql, checksum: migrationChecksum(sql) };
    }),
  );
}

function currentMigrationName(
  recordedName: string,
  files: ReadonlyMap<string, MigrationFile>,
): string | undefined {
  if (files.has(recordedName)) return recordedName;
  return LEGACY_MIGRATION_RENAMES[recordedName];
}

type MigrationPlan = {
  done: Set<string>;
  legacyH54: boolean;
};

function isLegacyH54Name(name: string): boolean {
  return LEGACY_H54_MIGRATION_NAME_SET.has(name);
}

async function hasLegacyH54Schema(
  client: pg.Client,
  records: readonly MigrationRecord[],
): Promise<boolean> {
  const baseline = records.find((record) => record.name === H54_BASELINE_MIGRATION);
  if (!baseline) return false;
  if (baseline.checksum !== null && LEGACY_H54_BASELINE_CHECKSUMS.has(baseline.checksum)) {
    return true;
  }

  // A pre-checksum ledger may contain the old 0730 name without enough
  // metadata to identify its file. Structural markers make that case safe to
  // recognize without weakening checksum validation for an otherwise-current
  // 0730 schema.
  const result = await client.query<{ legacy: boolean }>(
    `SELECT (
       EXISTS (
         SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'anonymous_participants'
            AND column_name IN ('age', 'gender', 'university', 'degree', 'graduation_year', 'origin_city')
       )
       OR EXISTS (
         SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'scanner_revoked_badges'
            AND column_name IN ('badge_id', 'expires_at')
       )
       OR EXISTS (
         SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'scanner_revoked_tickets'
            AND column_name IN ('ticket_token', 'expires_at')
       )
       OR EXISTS (
         SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name IN ('check_in_logs', 'time_logs')
            AND column_name = 'anonymous_participant_id'
       )
       OR NOT EXISTS (
         SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name = 'application_form_versions'
       )
     ) AS legacy`,
  );
  return result.rows[0]?.legacy ?? false;
}

async function prepareMigrationLedger(
  client: pg.Client,
  files: ReadonlyMap<string, MigrationFile>,
): Promise<MigrationPlan> {
  await client.query("BEGIN");
  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS _migrations (
         name text PRIMARY KEY,
         applied_at timestamptz NOT NULL DEFAULT now(),
         checksum text NOT NULL
       )`,
    );
    // Existing databases have the pre-checksum shape. Add the nullable column,
    // backfill it while the advisory lock is held, then enforce NOT NULL (H53).
    await client.query("ALTER TABLE _migrations ADD COLUMN IF NOT EXISTS checksum text");

    const records = (
      await client.query<MigrationRecord>("SELECT name, checksum FROM _migrations ORDER BY name")
    ).rows;
    const legacyH54 =
      records.some((record) => isLegacyH54Name(record.name)) ||
      (await hasLegacyH54Schema(client, records));
    const done = new Set<string>();
    for (const record of records) {
      if (isLegacyH54Name(record.name)) {
        if (record.checksum === null) {
          // The old chain predates the checksum column in some development
          // databases. Its file is intentionally no longer shipped, so use a
          // fixed historical marker rather than pretending the current file's
          // checksum describes it. Future runs skip this allow-listed name.
          await client.query("UPDATE _migrations SET checksum = $1 WHERE name = $2", [
            "0".repeat(64),
            record.name,
          ]);
        } else if (!/^[0-9a-f]{64}$/.test(record.checksum)) {
          throw new Error(
            `Historical H54 migration "${record.name}" has an invalid checksum; repair the ledger before deploying.`,
          );
        }
        continue;
      }
      const currentName = currentMigrationName(record.name, files);
      if (!currentName) {
        throw new Error(
          `Migration ledger contains "${record.name}", but this deployment has no matching ` +
            "migration file. Deploy the version that applied it or restore the migration bundle.",
        );
      }
      const migration = files.get(currentName);
      if (!migration) {
        throw new Error(
          `Migration ledger alias "${record.name}" points to missing file "${currentName}".`,
        );
      }
      if (done.has(currentName)) {
        throw new Error(
          `Migration ledger contains more than one record for "${currentName}" ` +
            `(including "${record.name}"). Repair the ledger before deploying.`,
        );
      }
      done.add(currentName);

      // A historical 0730 file has the same name as the squashed baseline,
      // but its schema is repaired by 0747 instead of being run a second time.
      if (legacyH54 && currentName === H54_BASELINE_MIGRATION) {
        continue;
      }

      if (record.checksum === null) {
        await client.query("UPDATE _migrations SET checksum = $1 WHERE name = $2", [
          migration.checksum,
          record.name,
        ]);
        continue;
      }
      if (record.checksum !== migration.checksum) {
        throw new Error(
          `Migration checksum mismatch for "${currentName}" (recorded as "${record.name}"). ` +
            `Database has ${record.checksum}; file has ${migration.checksum}. ` +
            "Applied migrations are immutable: restore the original file or create a new migration.",
        );
      }
    }

    if (legacyH54) done.add(H54_BASELINE_MIGRATION);

    await client.query("ALTER TABLE _migrations ALTER COLUMN checksum SET NOT NULL");
    await client.query("COMMIT");
    return { done, legacyH54 };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  }
}

export async function migrate(databaseUrl?: string): Promise<string[]> {
  const migrations = await readMigrationFiles();
  const files = new Map(migrations.map((migration) => [migration.name, migration]));
  const url = databaseUrl ?? process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const applied: string[] = [];
  try {
    // H54's populated-database conversion must retire legacy badge/ticket
    // values with the same keyed digest the API uses at scan time. Keep the
    // secret scoped to this migration session; it is never persisted in the
    // database or included in migration logs.
    await client.query("SELECT set_config($1, $2, false)", [
      MIGRATION_AUTH_SECRET_GUC,
      process.env.BETTER_AUTH_SECRET ?? DEFAULT_AUTH_SECRET,
    ]);
    await client.query("SELECT pg_advisory_lock($1)", [ADVISORY_LOCK_KEY]);
    const plan = await prepareMigrationLedger(client, files);
    for (const migration of migrations) {
      if (
        plan.done.has(migration.name) ||
        (migration.name === H54_LEGACY_COMPAT_MIGRATION && !plan.legacyH54)
      ) {
        continue;
      }
      await client.query("BEGIN");
      try {
        await client.query(migration.sql);
        await client.query("INSERT INTO _migrations (name, checksum) VALUES ($1, $2)", [
          migration.name,
          migration.checksum,
        ]);
        await client.query("COMMIT");
        applied.push(migration.name);
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${migration.name} failed: ${(err as Error).message}`, {
          cause: err,
        });
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY]).catch(() => {});
    await client.end();
  }
  return applied;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const applied = await migrate();
  console.log(applied.length ? `Applied: ${applied.join(", ")}` : "Already up to date");
}
