import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createUser, createUserWithCapabilities, truncateAll } from "../helpers.js";
import {
  callEntry,
  closeJudgingWindow,
  createScannableActivity,
  logScan,
  openJudgingWindow,
  participantInQueue,
  resetJudgingWindow,
} from "./fixtures.js";

/** #966 state builders: H38 queue selection, H25/H26 activity windows. */

beforeEach(async () => {
  await truncateAll();
  await resetJudgingWindow();
});

afterAll(async () => {
  await resetJudgingWindow();
  const { stopQueues } = await import("../../src/lib/queues.js");
  const { closeValkey } = await import("../../src/lib/valkey.js");
  const { pool } = await import("../../src/db/pool.js");
  await stopQueues();
  await closeValkey();
  await pool.end();
});

type Status = Parameters<
  typeof import("../../src/modules/live-activities/state.js").selectQueueLiveProps
>[0][number];

function status(overrides: Partial<Status>): Status {
  return {
    entryId: 1,
    challengeId: 1,
    challengeTitle: "Challenge",
    repoId: 1,
    repoName: "Repo",
    status: "waiting",
    position: 3,
    etaMinutes: 24,
    calledAt: null,
    room: null,
    rooms: [],
    ...overrides,
  } as Status;
}

describe("selectQueueLiveProps (H38)", () => {
  it("picks the waiting entry with the smallest ETA and counts the other live queues", async () => {
    const { selectQueueLiveProps } = await import("../../src/modules/live-activities/state.js");
    const props = selectQueueLiveProps(
      [
        status({ entryId: 1, challengeTitle: "Far", position: 6, etaMinutes: 48 }),
        status({ entryId: 2, challengeTitle: "Near", position: 2, etaMinutes: 16 }),
        status({ entryId: 3, challengeTitle: "Done", status: "completed", etaMinutes: null }),
        status({ entryId: 4, challengeTitle: "On stage", status: "presenting", etaMinutes: null }),
      ],
      "en",
      new Date("2026-10-11T10:00:00Z"),
    );
    expect(props).toMatchObject({
      kind: "queue",
      phase: "waiting",
      entryId: 2,
      challengeTitle: "Near",
      position: 2,
      etaMinutes: 16,
      roomName: null,
      roomLocation: null,
      otherQueues: 1,
      url: "hackos://queue",
      updatedAt: "2026-10-11T10:00:00.000Z",
    });
    expect(props?.labels.moreQueues).toBe("+1 more queues");
  });

  it("prefers a called entry over any waiting one and shows its room only then", async () => {
    const { selectQueueLiveProps } = await import("../../src/modules/live-activities/state.js");
    const props = selectQueueLiveProps(
      [
        status({ entryId: 1, position: 1, etaMinutes: 1 }),
        status({
          entryId: 2,
          challengeTitle: "Called",
          status: "called",
          position: null,
          etaMinutes: null,
          calledAt: "2026-10-11T09:59:00Z",
          room: { id: 7, name: "Room B", location: "Floor 2" },
        }),
      ],
      "es",
      new Date(),
    );
    expect(props).toMatchObject({
      phase: "called",
      entryId: 2,
      position: null,
      etaMinutes: null,
      roomName: "Room B",
      roomLocation: "Floor 2",
      otherQueues: 1,
    });
    expect(props?.labels.goTo).toBe("Ve a");
  });

  it("orders simultaneous calls by instant, as pg returns them (Date), not by weekday name", async () => {
    const { selectQueueLiveProps } = await import("../../src/modules/live-activities/state.js");
    // String(Date) starts with the weekday: "Sun Oct 11" sorts after "Mon Oct 12".
    const props = selectQueueLiveProps(
      [
        status({
          entryId: 1,
          challengeTitle: "Later call",
          status: "called",
          calledAt: new Date("2026-10-12T10:00:00Z") as unknown as string,
        }),
        status({
          entryId: 2,
          challengeTitle: "Earlier call",
          status: "called",
          calledAt: new Date("2026-10-11T10:00:00Z") as unknown as string,
        }),
      ],
      "en",
      new Date(),
    );
    expect(props?.challengeTitle).toBe("Earlier call");
  });

  it("returns null when nothing is live", async () => {
    const { selectQueueLiveProps } = await import("../../src/modules/live-activities/state.js");
    expect(
      selectQueueLiveProps(
        [status({ status: "completed" }), status({ status: "presenting" })],
        "en",
        new Date(),
      ),
    ).toBeNull();
  });
});

describe("myLiveActivities", () => {
  it("has no queue activity outside the judging window, even with a waiting entry", async () => {
    const { myLiveActivities } = await import("../../src/modules/live-activities/state.js");
    const { userId } = await participantInQueue();

    expect(await myLiveActivities(userId, "en", false)).toEqual({
      judgingWindowOpen: false,
      queue: null,
      activities: [],
    });
    await closeJudgingWindow();
    expect((await myLiveActivities(userId, "en", false)).queue).toBeNull();
  });

  it("builds the queue state from myQueueStatus inside the window; room only once called", async () => {
    const { myLiveActivities } = await import("../../src/modules/live-activities/state.js");
    await openJudgingWindow();
    const { userId, entryId, roomId } = await participantInQueue({ position: 3 });

    const waiting = await myLiveActivities(userId, "en", false);
    expect(waiting.judgingWindowOpen).toBe(true);
    expect(waiting.queue).toMatchObject({
      phase: "waiting",
      entryId,
      challengeTitle: "Robotics",
      position: 3,
      roomName: null,
      roomLocation: null,
      otherQueues: 0,
    });
    expect(waiting.queue?.etaMinutes).toBeGreaterThan(0);

    await callEntry(entryId, roomId);
    const called = await myLiveActivities(userId, "en", false);
    expect(called.queue).toMatchObject({
      phase: "called",
      position: null,
      etaMinutes: null,
      roomName: "Room B",
      roomLocation: "Floor 2",
    });
  });

  it("lists scannable activities in the lead window or in progress, with phase and distinct count", async () => {
    const { myLiveActivities } = await import("../../src/modules/live-activities/state.js");
    const staffId = await createUserWithCapabilities([CAPABILITIES.ACTIVITY_SCAN]);
    const upcoming = await createScannableActivity({
      name: "Dinner",
      nameI18n: { es: "Cena" },
      startsInMinutes: 10,
    });
    const live = await createScannableActivity({
      name: "Workshop",
      category: "workshop",
      requiresScan: true,
      startsInMinutes: -20,
      location: null,
    });
    await createScannableActivity({ name: "Too far", startsInMinutes: 30 });
    await createScannableActivity({ name: "Over", startsInMinutes: -90, durationMinutes: 60 });
    await createScannableActivity({
      name: "Not scannable",
      category: "talk",
      requiresScan: false,
      startsInMinutes: 5,
    });

    const attendee = await createUser();
    const other = await createUser();
    const fixture = await createUser();
    const { pool } = await import("../../src/db/pool.js");
    await pool.query(`UPDATE users SET is_test_account = true WHERE id = $1`, [fixture]);
    await logScan(live, attendee);
    await logScan(live, attendee);
    await logScan(live, other);
    await logScan(live, fixture);

    const result = await myLiveActivities(staffId, "es", true);
    expect(result.activities.map((a) => a.activityId)).toEqual([live, upcoming]);
    expect(result.activities[0]).toMatchObject({
      phase: "live",
      name: "Workshop",
      category: "workshop",
      location: null,
      scanned: 2,
      scanUrl: `hackos://scan?activity=${live}`,
      url: `hackos://scan?activity=${live}`,
    });
    expect(result.activities[1]).toMatchObject({
      phase: "upcoming",
      name: "Cena",
      location: "Hall A",
      scanned: 0,
      labels: { startsIn: "Empieza en", scanned: "Escaneados", scan: "Escanear" },
    });

    // A synthetic (review fixture) operator only counts synthetic subjects.
    await pool.query(`UPDATE users SET is_test_account = true WHERE id = $1`, [staffId]);
    const synthetic = await myLiveActivities(staffId, "es", true);
    expect(synthetic.activities[0]?.scanned).toBe(1);

    expect((await myLiveActivities(staffId, "es", false)).activities).toEqual([]);
  });

  it("resolves ACTIVITY_SCAN holders in one query, including the wildcard", async () => {
    const { usersWithActivityScan } = await import("../../src/modules/live-activities/state.js");
    const scanner = await createUserWithCapabilities([CAPABILITIES.ACTIVITY_SCAN]);
    const admin = await createUserWithCapabilities([CAPABILITIES.ADMIN_ALL]);
    const plain = await createUser();
    expect([...(await usersWithActivityScan([scanner, admin, plain]))].sort()).toEqual(
      [scanner, admin].sort(),
    );
  });
});
