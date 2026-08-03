import "./env.js";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "../../src/db/pool.js";
import { truncateAll } from "../helpers.js";

/**
 * What the venue screens show (H42). Two layers compose: the tv_slots
 * timetable (absolute windows, so the fleet follows the event unattended) and
 * one operator override on top of it, which expires or is cleared by hand.
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

async function insertSlot(opts: {
  label?: string;
  startsAt: Date;
  endsAt: Date;
  items: Array<{ mode: string; payload?: unknown; seconds?: number | null }>;
}) {
  const { rows } = await pool.query(
    `INSERT INTO tv_slots (label, starts_at, ends_at, items)
     VALUES ($1, $2, $3, $4::jsonb) RETURNING id`,
    [
      opts.label ?? null,
      opts.startsAt,
      opts.endsAt,
      JSON.stringify(
        opts.items.map((item) => ({
          mode: item.mode,
          payload: item.payload ?? null,
          seconds: item.seconds ?? null,
        })),
      ),
    ],
  );
  return Number(rows[0].id);
}

const minutesFromNow = (minutes: number) => new Date(Date.now() + minutes * 60_000);

describe("tv state resolution (H42)", () => {
  it("falls back to the default rooms view when nothing is scheduled", async () => {
    const { resolveTvState } = await import("../../src/modules/queue/tv.js");
    expect(await resolveTvState()).toMatchObject({
      mode: "rooms",
      source: "default",
      slot: null,
    });
  });

  it("shows the slot covering now, and nothing once its window has passed", async () => {
    const { resolveTvState } = await import("../../src/modules/queue/tv.js");
    await insertSlot({
      label: "Hacking",
      startsAt: minutesFromNow(-60),
      endsAt: minutesFromNow(60),
      items: [{ mode: "live" }],
    });

    const during = await resolveTvState();
    expect(during).toMatchObject({ mode: "live", source: "slot" });
    expect(during.slot?.label).toBe("Hacking");

    // Resolution is time-parameterised, so "later" needs no clock mocking.
    expect(await resolveTvState(minutesFromNow(120))).toMatchObject({
      mode: "rooms",
      source: "default",
    });
  });

  it("prefers the latest-starting slot when windows overlap", async () => {
    const { resolveTvState } = await import("../../src/modules/queue/tv.js");
    // An all-day slot with a short ceremony window sitting inside it: the
    // narrower, later-starting one is the one an organiser meant to win.
    await insertSlot({
      label: "All day",
      startsAt: minutesFromNow(-600),
      endsAt: minutesFromNow(600),
      items: [{ mode: "live" }],
    });
    await insertSlot({
      label: "Sponsor wall",
      startsAt: minutesFromNow(-5),
      endsAt: minutesFromNow(25),
      items: [{ mode: "sponsors" }],
    });

    const state = await resolveTvState();
    expect(state).toMatchObject({ mode: "sponsors", source: "slot" });
    expect(state.slot?.label).toBe("Sponsor wall");
  });

  it("carries every rotation item so the display can cycle them", async () => {
    const { resolveTvState } = await import("../../src/modules/queue/tv.js");
    await insertSlot({
      startsAt: minutesFromNow(-1),
      endsAt: minutesFromNow(60),
      items: [
        { mode: "live", seconds: 60 },
        { mode: "sponsors", seconds: 20 },
      ],
    });

    const state = await resolveTvState();
    // The first item is what a client renders before it starts rotating.
    expect(state.mode).toBe("live");
    expect(state.slot?.items).toEqual([
      { mode: "live", payload: null, seconds: 60 },
      { mode: "sponsors", payload: null, seconds: 20 },
    ]);
  });

  it("lets an operator override beat a running slot, and hands back on clear", async () => {
    const { resolveTvState, setTvMode, clearTvOverride } = await import(
      "../../src/modules/queue/tv.js"
    );
    await insertSlot({
      label: "Judging",
      startsAt: minutesFromNow(-10),
      endsAt: minutesFromNow(120),
      items: [{ mode: "rooms" }],
    });

    await setTvMode("live", null);
    expect(await resolveTvState()).toMatchObject({
      mode: "live",
      source: "override",
      slot: null,
    });

    // "Back to schedule" lands on whatever is running at that moment, not on
    // the pre-override default.
    const cleared = await clearTvOverride();
    expect(cleared).toMatchObject({ mode: "rooms", source: "slot" });
    expect(cleared.slot?.label).toBe("Judging");
  });
});

describe("tv scheduler worker (H42)", () => {
  it("drops an override once it is due and returns to the timetable", async () => {
    const { setTvMode, resolveTvState } = await import("../../src/modules/queue/tv.js");
    const { runTvSchedulerOnce } = await import("../../src/modules/queue/tv-scheduler.js");
    await insertSlot({
      startsAt: minutesFromNow(-10),
      endsAt: minutesFromNow(120),
      items: [{ mode: "live" }],
    });

    await setTvMode("wifi", { ssid: "hackOS" }, minutesFromNow(60).toISOString());
    expect(await runTvSchedulerOnce()).toMatchObject({ reverted: false });
    expect((await resolveTvState()).mode).toBe("wifi");

    await setTvMode("live", null, new Date(Date.now() - 1000).toISOString());
    expect(await runTvSchedulerOnce()).toMatchObject({ reverted: true });
    expect(await resolveTvState()).toMatchObject({ mode: "live", source: "slot" });

    // Re-running is a no-op: the override is gone, not merely expired.
    expect(await runTvSchedulerOnce()).toMatchObject({ reverted: false });
  });

  it("broadcasts on a slot boundary but stays silent on a quiet tick", async () => {
    const { runTvSchedulerOnce } = await import("../../src/modules/queue/tv-scheduler.js");

    // First tick publishes the starting state (default rooms, nothing known yet).
    expect(await runTvSchedulerOnce()).toMatchObject({ changed: true });
    expect(await runTvSchedulerOnce()).toMatchObject({ changed: false });

    await insertSlot({
      startsAt: minutesFromNow(-1),
      endsAt: minutesFromNow(60),
      items: [{ mode: "live" }],
    });

    // A slot window opening is a change the fleet must hear about…
    expect(await runTvSchedulerOnce()).toMatchObject({ changed: true });
    // …but nothing happening is not, so screens aren't woken every 5s.
    expect(await runTvSchedulerOnce()).toMatchObject({ changed: false });
  });
});
