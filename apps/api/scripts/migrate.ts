/**
 * SQL migration runner. Applies db/migrations/*.sql in lexicographic order,
 * each inside its own transaction, recording applied files in _migrations.
 * A Postgres advisory lock serializes concurrent runners.
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
    if (!sequence) throw new Error(`Migration filename "${file}" has no sequence prefix.`);
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

async function prepareMigrationLedger(
  client: pg.Client,
  files: ReadonlyMap<string, MigrationFile>,
): Promise<Set<string>> {
  await client.query("BEGIN");
  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS public._migrations (
         name text PRIMARY KEY,
         applied_at timestamptz NOT NULL DEFAULT now(),
         checksum text NOT NULL
       )`,
    );
    await client.query("ALTER TABLE public._migrations ADD COLUMN IF NOT EXISTS checksum text");

    const records = (
      await client.query<MigrationRecord>(
        "SELECT name, checksum FROM public._migrations ORDER BY name",
      )
    ).rows;
    const done = new Set<string>();
    for (const record of records) {
      const migration = files.get(record.name);
      if (!migration) {
        throw new Error(
          `Migration ledger contains "${record.name}", but this deployment has no matching ` +
            "migration file. Recreate the database from the consolidated baseline.",
        );
      }
      done.add(record.name);
      if (record.checksum === null) {
        await client.query("UPDATE public._migrations SET checksum = $1 WHERE name = $2", [
          migration.checksum,
          record.name,
        ]);
      } else if (record.checksum !== migration.checksum) {
        throw new Error(
          `Migration checksum mismatch for "${record.name}". Database has ${record.checksum}; ` +
            `file has ${migration.checksum}. Applied migrations are immutable: restore the original ` +
            "file or create a new migration.",
        );
      }
    }

    await client.query("ALTER TABLE public._migrations ALTER COLUMN checksum SET NOT NULL");
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
    await client.query("SELECT pg_advisory_lock($1)", [ADVISORY_LOCK_KEY]);
    const done = await prepareMigrationLedger(client, files);
    for (const migration of migrations) {
      if (done.has(migration.name)) continue;
      await client.query("BEGIN");
      try {
        await client.query(migration.sql);
        await client.query("INSERT INTO public._migrations (name, checksum) VALUES ($1, $2)", [
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
