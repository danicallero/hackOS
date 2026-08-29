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

// The follow-up files were removed when H54 was squashed, so their hashes
// cannot be recomputed from the current bundle. Keep the historical hashes
// that were actually shipped, while accepting the all-zero marker used by
// pre-checksum ledgers. An explicit name plus a known hash is the trust
// boundary for the compatibility path; arbitrary ledger entries must stop.
const LEGACY_H54_MIGRATION_CHECKSUMS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "0731_account_removal_scanner_tombstones.sql": [
    "faa734fc6d982eb674215513f6e6a60220b17705828bdc84ccd66677b5baea28",
  ],
  "0732_account_removal_meal_inbox.sql": [
    "2ba354711790a780b4ed32d057da9ce5b399bfec994d92de18fc7000dad7d99d",
  ],
  "0733_account_removal_reference_guards.sql": [
    "168300c4d9cdeb7b7dbd78dfffc1d211cb97cbbe9978fbb3fd1ad6184177653c",
    "414668bdf132fab8a0a81f06fa41ca3dc9eac5248ffcd311ea2557cae48cddcd",
  ],
  "0734_account_removal_minimization.sql": [
    "fad1150e41a5893957fa26039d0def3b6b7707ac5a41387a451ca7dfadd5f618",
  ],
  "0735_schema_driven_anonymous_retention.sql": [
    "54273f852239d647deab82960951b9283df2d5288e3531fa6be4b6e088166906",
    "e73fd4255d7956a3a1308a95318908601fa10eea18fae3e0226784aebcfbeb5a",
  ],
  "0736_account_removal_pending_exit.sql": [
    "520d26edd73507ee022441149fe83394cc7ded645955033cf8baa359f1205e2f",
  ],
  "0737_permanent_scanner_credential_tombstones.sql": [
    "d5ab4c87d1408b4fc9ad02613c9b5a418aa7e5210cde7f382b9ba81f75dacd04",
  ],
  "0738_application_response_form_version_integrity.sql": [
    "bcbddbcff8425602606b11ee55dea990f93ef157586fcc0a86ba2cabc8e48523",
  ],
  "0739_pending_exit_event_close.sql": [
    "a37830ff9774adc39409dbfad6816d332bb73a4cd9f713cdaf243634725512b9",
  ],
  "0740_account_removal_email_pin.sql": [
    "f2cca9c5a86e847e921d98c192eb2c1f733cf365e093c79b4cdb8737b0dc7274",
  ],
  "0741_keyed_scanner_credential_tombstones.sql": [
    "2d13b5dc68f1e68223a0cc23e70e615d3bfed1d9338f7765875ae81ed5326895",
  ],
  "0742_account_removal_pending_recovery.sql": [
    "53f7c96b8f0010e7c4656157ee01a4f6e81c85fdfc9b0b00f560eacb63043961",
  ],
  "0743_review_fixture_accounts.sql": [
    "2a86115829cce5ddeaea15475d5fae1aebe92deeb3d79011249973e8f739bb9f",
    "3f5edcef61941a666eaca543e05760f282351ba63136276f2a84dba176746e91",
  ],
  "0744_review_fixture_queues.sql": [
    "eb02ce2b00f8ec4fa6b107da1fccd073ad2db91ebdc89bbae88040b53c29423d",
  ],
  "0745_badge_assignment_timestamp.sql": [
    "a088146036025a20e3f81960027c90c24793597a0dcd208493b47d4b66703a00",
  ],
  "0746_permanent_scanner_tombstones.sql": [
    "f7e78fd7de0a9abfff949dae25d30cdc85bbc81bc10b38f318cbac1954c8c672",
  ],
});
const LEGACY_H54_CHECKSUM_SENTINEL = "0".repeat(64);

function isKnownLegacyH54Checksum(name: string, checksum: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(checksum)) return false;
  if (checksum === LEGACY_H54_CHECKSUM_SENTINEL) return true;
  if (name === H54_BASELINE_MIGRATION) return LEGACY_H54_BASELINE_CHECKSUMS.has(checksum);
  return LEGACY_H54_MIGRATION_CHECKSUMS[name]?.includes(checksum) ?? false;
}

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
            LEGACY_H54_CHECKSUM_SENTINEL,
            record.name,
          ]);
        } else if (!isKnownLegacyH54Checksum(record.name, record.checksum)) {
          throw new Error(
            `Historical H54 migration "${record.name}" has an unknown checksum; repair the ledger before deploying.`,
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
        if (record.checksum === null) {
          // Some pre-checksum ledgers recorded the historical 0730 row as
          // NULL. Normalize it before enforcing the ledger's NOT NULL
          // invariant; the marker is deliberately not the current file hash.
          await client.query("UPDATE _migrations SET checksum = $1 WHERE name = $2", [
            LEGACY_H54_CHECKSUM_SENTINEL,
            record.name,
          ]);
        } else if (!isKnownLegacyH54Checksum(record.name, record.checksum)) {
          throw new Error(
            `Historical H54 migration "${record.name}" has an unknown checksum; repair the ledger before deploying.`,
          );
        }
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
