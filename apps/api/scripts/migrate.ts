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

async function prepareMigrationLedger(
  client: pg.Client,
  files: ReadonlyMap<string, MigrationFile>,
): Promise<Set<string>> {
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
    const done = new Set<string>();
    for (const record of records) {
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

    await client.query("ALTER TABLE _migrations ALTER COLUMN checksum SET NOT NULL");
    await client.query("COMMIT");
    return done;
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
    const done = await prepareMigrationLedger(client, files);
    for (const migration of migrations) {
      if (done.has(migration.name)) continue;
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
