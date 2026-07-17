import "./env.js";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "../../src/db/pool.js";
import { truncateAll } from "../helpers.js";

/**
 * Automatic TV mode expiry (H42, issue #193): a mode set with expiresAt in
 * the past reverts the whole fleet back to "rooms" without a human having to
 * remember to switch it back.
 */

beforeEach(async () => {
  await truncateAll();
  const { valkey } = await import("../../src/lib/valkey.js");
  await valkey.flushdb();
});

afterAll(async () => {
  const { stopQueues } = await import("../../src/lib/queues.js");
  const { closeValkey } = await import("../../src/lib/valkey.js");
  await stopQueues();
  await closeValkey();
  await pool.end();
});

describe("tv mode expiry publisher (H42, issue #193)", () => {
  it("reverts to rooms once expiresAt has passed, and is a no-op otherwise", async () => {
    const { setTvMode } = await import("../../src/modules/queue/tv.js");
    const { runTvExpiryPublisherOnce } = await import("../../src/modules/queue/tv-expiry.js");

    await setTvMode(
      "wifi",
      { ssid: "hackOS", password: "s3cr3t" },
      new Date(Date.now() + 3_600_000).toISOString(),
    );
    const notYetDue = await runTvExpiryPublisherOnce();
    expect(notYetDue.reverted).toBe(false);
    const { getTvMode } = await import("../../src/modules/queue/tv.js");
    expect((await getTvMode()).mode).toBe("wifi");

    await setTvMode("announcement", { title: "Fuego" }, new Date(Date.now() - 1000).toISOString());
    const due = await runTvExpiryPublisherOnce();
    expect(due.reverted).toBe(true);
    expect(await getTvMode()).toMatchObject({ mode: "rooms", payload: null, expiresAt: null });

    // Re-running is a no-op: expiresAt was cleared by the revert itself.
    const again = await runTvExpiryPublisherOnce();
    expect(again.reverted).toBe(false);
  });

  it("does nothing when no expiresAt is set", async () => {
    const { setTvMode, getTvMode } = await import("../../src/modules/queue/tv.js");
    const { runTvExpiryPublisherOnce } = await import("../../src/modules/queue/tv-expiry.js");

    await setTvMode("schedule", null);
    const result = await runTvExpiryPublisherOnce();
    expect(result.reverted).toBe(false);
    expect((await getTvMode()).mode).toBe("schedule");
  });
});
