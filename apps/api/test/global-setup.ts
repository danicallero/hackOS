/**
 * Runs once per `vitest` invocation, BEFORE test env vars from setup.ts:
 * wipes hackos_test and re-applies every migration, so tests always run on
 * the exact schema in db/migrations. Requires docker compose infra
 * (`pnpm infra:up` at the repo root).
 */
import pg from "pg";
import { migrate } from "../scripts/migrate.js";
import { TEST_DATABASE_URL } from "./test-env.js";

export default async function globalSetup(): Promise<void> {
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
}
