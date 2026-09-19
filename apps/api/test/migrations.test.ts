import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate, migrationChecksum, validateMigrationFilenames } from "../scripts/migrate.js";
import { renderSchemaDbml } from "../scripts/schema-dbml.js";
import { TEST_DATABASE_URL } from "./test-env.js";

const databaseName = `hackos_migrations_${process.pid}_${randomUUID().replaceAll("-", "")}`;
const databaseUrl = new URL(TEST_DATABASE_URL);
databaseUrl.pathname = `/${databaseName}`;
const adminUrl = new URL(TEST_DATABASE_URL);
adminUrl.pathname = "/postgres";

beforeAll(async () => {
  const client = new pg.Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try {
    await client.query(`CREATE DATABASE "${databaseName}"`);
  } finally {
    await client.end();
  }
});

afterAll(async () => {
  const client = new pg.Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
  } finally {
    await client.end();
  }
});

async function withClient<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: databaseUrl.toString() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

describe("consolidated migration baseline (H1-H59)", () => {
  it("is the sole active migration and concurrent first applies serialize", async () => {
    const names = (
      await readdir(join(dirname(fileURLToPath(import.meta.url)), "..", "db", "migrations"))
    )
      .filter((name) => name.endsWith(".sql"))
      .sort();
    expect(names).toEqual(["0001_hackos_baseline.sql"]);

    const results = await Promise.all([
      migrate(databaseUrl.toString()),
      migrate(databaseUrl.toString()),
    ]);
    expect(results.filter((result) => result.length > 0)).toEqual([["0001_hackos_baseline.sql"]]);
  });

  it("matches the checked-in ERD and retains the required relational boundaries", async () => {
    const [dbml, committed, contract] = await Promise.all([
      renderSchemaDbml(databaseUrl.toString()),
      readFile(join(dirname(fileURLToPath(import.meta.url)), "..", "db", "schema.dbml"), "utf8"),
      withClient(async (client) => {
        const tables = await client.query<{ name: string | null }>(
          `SELECT to_regclass(name) AS name
             FROM unnest($1::text[]) AS names(name)`,
          [
            [
              "public.roles",
              "public.user_roles",
              "public.application_form_versions",
              "public.queue_groups",
              "public.queue_entries",
              "public.scanner_revoked_badges",
              "public.statistics_scope_panel_role_access",
            ],
          ],
        );
        const defaults = await client.query<{
          roles: string;
          event_config: string;
          queue_settings: string;
        }>(
          `SELECT
             (SELECT count(*)::text FROM roles) AS roles,
             (SELECT count(*)::text FROM event_config) AS event_config,
             (SELECT count(*)::text FROM queue_settings) AS queue_settings`,
        );
        return { tables: tables.rows, defaults: defaults.rows[0] };
      }),
    ]);

    expect(dbml).toBe(committed);
    expect(contract.tables.map((table) => table.name)).toEqual([
      "roles",
      "user_roles",
      "application_form_versions",
      "queue_groups",
      "queue_entries",
      "scanner_revoked_badges",
      "statistics_scope_panel_role_access",
    ]);
    expect(contract.defaults).toEqual({ roles: "15", event_config: "1", queue_settings: "1" });
  });

  it("is a no-op after the first apply and protects its ledger checksum", async () => {
    await expect(migrate(databaseUrl.toString())).resolves.toEqual([]);
    const original = await withClient((client) =>
      client.query<{ checksum: string }>("SELECT checksum FROM _migrations WHERE name = $1", [
        "0001_hackos_baseline.sql",
      ]),
    );
    await withClient((client) =>
      client.query("UPDATE _migrations SET checksum = $1 WHERE name = $2", [
        "deadbeef",
        "0001_hackos_baseline.sql",
      ]),
    );
    await expect(migrate(databaseUrl.toString())).rejects.toThrow(
      /Migration checksum mismatch for "0001_hackos_baseline\.sql"/,
    );
    await withClient((client) =>
      client.query("UPDATE _migrations SET checksum = $1 WHERE name = $2", [
        original.rows[0]?.checksum,
        "0001_hackos_baseline.sql",
      ]),
    );
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
  });
});
