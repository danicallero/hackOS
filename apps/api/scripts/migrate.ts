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
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "db", "migrations");
const ADVISORY_LOCK_KEY = 815_001;

export async function migrate(databaseUrl?: string): Promise<string[]> {
  const url =
    databaseUrl ?? process.env.DATABASE_URL ?? "postgres://hackos:hackos@localhost:5433/hackos";
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query("SELECT pg_advisory_lock($1)", [ADVISORY_LOCK_KEY]);
    await client.query(
      `CREATE TABLE IF NOT EXISTS _migrations (
         name text PRIMARY KEY,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    );
    const done = new Set(
      (await client.query("SELECT name FROM _migrations")).rows.map((r) => r.name as string),
    );
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(join(MIGRATIONS_DIR, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO _migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
        applied.push(file);
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`, { cause: err });
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
