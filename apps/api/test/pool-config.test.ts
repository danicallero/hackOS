import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { config } from "../src/config.js";
import { isTimeoutError } from "../src/lib/db-errors.js";

/**
 * #540: pool sizing/timeouts are env-driven, saturation makes callers wait
 * (not hang forever), and Postgres timeouts surface as classifiable errors.
 * Uses scratch pools, never the shared `pool` other suites depend on.
 */

const scratchPools: pg.Pool[] = [];
function scratchPool(opts: Partial<pg.PoolConfig> = {}): pg.Pool {
  const p = new pg.Pool({ connectionString: config.DATABASE_URL, ...opts });
  scratchPools.push(p);
  return p;
}

afterAll(async () => {
  await Promise.all(scratchPools.map((p) => p.end()));
});

describe("pool configuration (#540)", () => {
  it("rejects pool.connect() within connectionTimeoutMillis once the pool is saturated", async () => {
    const p = scratchPool({ max: 1, connectionTimeoutMillis: 200 });
    const held = await p.connect();
    await held.query("BEGIN");
    try {
      const start = Date.now();
      await expect(p.connect()).rejects.toThrow();
      expect(Date.now() - start).toBeLessThan(1_000);
    } finally {
      await held.query("ROLLBACK");
      held.release();
    }
  });

  it("aborts a query past statement_timeout with a classifiable timeout error", async () => {
    const p = scratchPool({ max: 1 });
    const client = await p.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout = '50'");
      await expect(client.query("SELECT pg_sleep(1)")).rejects.toMatchObject({ code: "57014" });
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    }
  });

  it("isTimeoutError classifies statement_timeout and idle-in-transaction codes only", () => {
    expect(isTimeoutError({ code: "57014" })).toBe(true);
    expect(isTimeoutError({ code: "25P03" })).toBe(true);
    expect(isTimeoutError({ code: "23505" })).toBe(false);
    expect(isTimeoutError(new Error("boom"))).toBe(false);
    expect(isTimeoutError(null)).toBe(false);
  });
});
