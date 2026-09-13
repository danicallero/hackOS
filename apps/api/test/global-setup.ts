/**
 * Runs once per `vitest` invocation, BEFORE test env vars from setup.ts:
 * wipes hackos_test and re-applies every migration, so tests always run on
 * the exact schema in db/migrations. Requires docker compose infra
 * (`pnpm infra:up` at the repo root).
 */
import pg from "pg";
import { migrate } from "../scripts/migrate.js";
import { TEST_DATABASE_URL } from "./test-env.js";

export default async function globalSetup(): Promise<void | (() => Promise<void>)> {
  await ensureTestDatabase();
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  try {
    await client.connect();
  } catch (err) {
    throw new Error(
      `Cannot reach the test database at ${TEST_DATABASE_URL}. ` +
        `Start local infra first: pnpm infra:up (repo root). (${(err as Error).message})`,
    );
  }
  await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await client.end();
  await migrate(TEST_DATABASE_URL);

  if (process.env.TEST_DATABASE_EPHEMERAL === "true") {
    return async () => {
      const { adminUrl, databaseName } = testDatabaseAddress();
      const admin = new pg.Client({ connectionString: adminUrl });
      await admin.connect();
      try {
        await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)} WITH (FORCE)`);
      } finally {
        await admin.end();
      }
    };
  }
}

/** Create an isolated shard database when the parallel test runner asks for one. */
async function ensureTestDatabase(): Promise<void> {
  const { adminUrl, databaseName } = testDatabaseAddress();
  const admin = new pg.Client({ connectionString: adminUrl });
  try {
    await admin.connect();
    const { rowCount } = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [
      databaseName,
    ]);
    if (rowCount === 0) {
      await admin.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
    }
  } finally {
    await admin.end();
  }
}

function testDatabaseAddress(): { adminUrl: string; databaseName: string } {
  const databaseUrl = new URL(TEST_DATABASE_URL);
  const databaseName = decodeURIComponent(databaseUrl.pathname.slice(1));
  if (!/^[A-Za-z0-9_]+$/.test(databaseName)) {
    throw new Error(`Unsafe test database name: ${databaseName}`);
  }
  databaseUrl.pathname = "/postgres";
  return { adminUrl: databaseUrl.toString(), databaseName };
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}
