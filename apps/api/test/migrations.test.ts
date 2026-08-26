import { randomUUID } from "node:crypto";
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
        await adminClient.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
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
