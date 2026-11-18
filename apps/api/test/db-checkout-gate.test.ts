import type pg from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { config } from "../src/config.js";
import { pool } from "../src/db/pool.js";
import { runWithRequestContext } from "../src/lib/request-context.js";
import type { RequestLane } from "../src/lib/request-lanes.js";

// #1367: pooled-connection checkouts are ordered by request lane, and a share
// of the pool stays reserved for P0/P1 even while best-effort requests wait.
const reserved = Math.min(config.dbPoolMax - 1, Math.ceil(config.dbPoolMax / 4));
const bestEffortCap = config.dbPoolMax - reserved;

const held: pg.PoolClient[] = [];
const connectAs = (lane: RequestLane) => runWithRequestContext({ lane }, () => pool.connect());

afterEach(() => {
  for (const client of held.splice(0)) client.release();
});

describe("lane-aware pool checkout (#1367)", () => {
  it("keeps the reserved connections for operations while participants wait", async () => {
    for (let i = 0; i < bestEffortCap; i++) held.push(await connectAs("P3"));

    let participantServed = false;
    const participant = connectAs("P3").then((client) => {
      participantServed = true;
      return client;
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(participantServed).toBe(false);

    // An operational checkout skips the queue into the reserved share.
    const operator = await connectAs("P0");
    expect((await operator.query("SELECT 1 AS ok")).rows[0].ok).toBe(1);
    operator.release();
    expect(participantServed).toBe(false);

    held.pop()?.release();
    held.push(await participant);
    expect(participantServed).toBe(true);
  });

  it("serves a waiting operation before a participant queued earlier", async () => {
    for (let i = 0; i < config.dbPoolMax; i++) held.push(await connectAs("P1"));
    const order: string[] = [];
    const participant = connectAs("P3").then((client) => {
      order.push("P3");
      return client;
    });
    const operator = connectAs("P0").then((client) => {
      order.push("P0");
      return client;
    });
    held.pop()?.release();
    held.push(await operator);
    expect(order).toEqual(["P0"]);
    // The participant waits until best-effort work is back under its share.
    for (const client of held.splice(0)) client.release();
    held.push(await participant);
    expect(order).toEqual(["P0", "P3"]);
  });

  it("lets a request that already holds a connection take a second one", async () => {
    // The best-effort share is full, one connection held by this request.
    const context = { lane: "P3" as const };
    for (let i = 0; i < bestEffortCap - 1; i++) held.push(await connectAs("P3"));
    held.push(await runWithRequestContext(context, () => pool.connect()));
    // A plain participant checkout waits, but this request's nested one is
    // served from the reserve, so a lock holder can always finish.
    let participantServed = false;
    const participant = connectAs("P3").then((client) => {
      participantServed = true;
      return client;
    });
    const nested = await runWithRequestContext(context, () => pool.query("SELECT 1 AS ok"));
    expect(nested.rows[0].ok).toBe(1);
    expect(participantServed).toBe(false);
    held.pop()?.release();
    held.push(await participant);
  });

  it("returns the connection and its gate slot through pool.query", async () => {
    const results = await Promise.all(
      Array.from({ length: config.dbPoolMax * 3 }, () =>
        runWithRequestContext({ lane: "P3" }, () => pool.query("SELECT 1")),
      ),
    );
    expect(results).toHaveLength(config.dbPoolMax * 3);
    for (let i = 0; i < bestEffortCap; i++) held.push(await connectAs("P3"));
  });
});
