import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createUser, createUserWithCapabilities, truncateAll } from "../helpers.js";
import {
  allowLiveActivities,
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

/** The read model with the permissive test configuration (fixtures.ts). */
async function mine(userId: number, language: "es" | "gl" | "en") {
  await allowLiveActivities();
  const { myLiveActivities } = await import("../../src/modules/live-activities/candidates.js");
  return myLiveActivities(userId, language);
}

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
    queueTotal: 5,
    calledAhead: null,
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
        status({ entryId: 2, challengeTitle: "Near", position: 2, etaMinutes: 16, queueTotal: 7 }),
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
      queueTotal: 7,
      calledAhead: null,
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
          queueTotal: 9,
          calledAhead: 2,
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
      calledAt: "2026-10-11T09:59:00.000Z",
      queueTotal: null,
      calledAhead: 2,
      otherQueues: 1,
    });
    expect(props?.labels.goTo).toBe("Ve a");
    expect(props?.labels.stageCalled).toBe("Llamados");
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
    const myLiveActivities = mine;
    const { userId } = await participantInQueue();

    expect(await myLiveActivities(userId, "en")).toEqual({
      judgingWindowOpen: false,
      queue: null,
      activities: [],
      attendeeActivities: [],
      deadline: null,
      accreditation: null,
      maxConcurrent: 5,
    });
    await closeJudgingWindow();
    expect((await myLiveActivities(userId, "en")).queue).toBeNull();
  });

  it("builds the queue state from myQueueStatus inside the window; room only once called", async () => {
    const myLiveActivities = mine;
    await openJudgingWindow();
    const { userId, entryId, roomId } = await participantInQueue({ position: 3 });

    const waiting = await myLiveActivities(userId, "en");
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
    expect(waiting.queue?.calledAt).toBeNull();
    // Three teams in the queue: the progress track is partly full at first sight.
    expect(waiting.queue).toMatchObject({ queueTotal: 3, calledAhead: null });

    await callEntry(entryId, roomId);
    const called = await myLiveActivities(userId, "en");
    expect(called.queue).toMatchObject({
      phase: "called",
      position: null,
      etaMinutes: null,
      roomName: "Room B",
      roomLocation: "Floor 2",
      queueTotal: null,
      calledAhead: 0,
    });
  });

  it("counts every team in the queue, judged ones included, as the progress total", async () => {
    const myLiveActivities = mine;
    const { pool } = await import("../../src/db/pool.js");
    await openJudgingWindow();
    const { userId, entryId, challengeId } = await participantInQueue({ position: 4 });
    expect((await myLiveActivities(userId, "en")).queue).toMatchObject({
      position: 4,
      queueTotal: 4,
    });

    // Two teams ahead are judged: the position drops, the total stays.
    await pool.query(
      `UPDATE queue_entries SET status = 'completed'
        WHERE id IN (SELECT id FROM queue_entries
                      WHERE challenge_id = $1 AND id <> $2 ORDER BY id LIMIT 2)`,
      [challengeId, entryId],
    );
    expect((await myLiveActivities(userId, "en")).queue).toMatchObject({
      position: 2,
      queueTotal: 4,
    });

    // A cancelled team and a synthetic (H54) team are not part of the queue.
    const { rows } = await pool.query<{ id: number; repo_id: number }>(
      `SELECT id, repo_id FROM queue_entries
        WHERE challenge_id = $1 AND status = 'completed' ORDER BY id`,
      [challengeId],
    );
    await pool.query(`UPDATE queue_entries SET status = 'cancelled' WHERE id = $1`, [rows[0]!.id]);
    await pool.query(`UPDATE repos SET is_test_account = true WHERE id = $1`, [rows[1]!.repo_id]);
    expect((await myLiveActivities(userId, "en")).queue).toMatchObject({ queueTotal: 2 });
  });

  it("counts teams called earlier to the same room and not yet in it", async () => {
    const myLiveActivities = mine;
    const { pool } = await import("../../src/db/pool.js");
    await openJudgingWindow();
    const { userId, entryId, challengeId, roomId } = await participantInQueue({ position: 4 });
    const { rows } = await pool.query<{ id: number; repo_id: number }>(
      `SELECT id, repo_id FROM queue_entries WHERE challenge_id = $1 AND id <> $2 ORDER BY id`,
      [challengeId, entryId],
    );
    const [first, second, third] = rows as [
      { id: number; repo_id: number },
      { id: number; repo_id: number },
      { id: number; repo_id: number },
    ];
    // Two called earlier and still outside, one already in the room.
    await pool.query(
      `UPDATE queue_entries
          SET status = (CASE WHEN id = $3 THEN 'in_room' ELSE 'called' END)::queue_status,
              assigned_room_id = $1,
              called_at = now() - make_interval(mins => 10 - (id - $2))
        WHERE id = ANY($4::int[])`,
      [roomId, first.id, third.id, [first.id, second.id, third.id]],
    );
    await callEntry(entryId, roomId);
    expect((await myLiveActivities(userId, "en")).queue).toMatchObject({
      phase: "called",
      calledAhead: 2,
    });

    // A synthetic (H54) team never counts for a real one.
    await pool.query(`UPDATE repos SET is_test_account = true WHERE id = $1`, [first.repo_id]);
    expect((await myLiveActivities(userId, "en")).queue).toMatchObject({ calledAhead: 1 });

    // The room frees up and the last team ahead enters it.
    await pool.query(`UPDATE queue_entries SET status = 'completed' WHERE id = $1`, [third.id]);
    await pool.query(`UPDATE queue_entries SET status = 'in_room' WHERE id = $1`, [second.id]);
    expect((await myLiveActivities(userId, "en")).queue).toMatchObject({ calledAhead: 0 });
  });

  it("breaks a live meal down into inside and still-to-eat; other activities get none", async () => {
    const myLiveActivities = mine;
    const { pool } = await import("../../src/db/pool.js");
    const staffId = await createUserWithCapabilities([CAPABILITIES.ACTIVITY_SCAN]);
    const lunch = await createScannableActivity({ name: "Lunch", startsInMinutes: -10 });
    const dinner = await createScannableActivity({ name: "Dinner", startsInMinutes: 10 });
    const workshop = await createScannableActivity({
      name: "Workshop",
      category: "workshop",
      requiresScan: true,
      startsInMinutes: -5,
    });
    const [a, b, c, gone] = [
      await createUser(),
      await createUser(),
      await createUser(),
      await createUser(),
    ];
    for (const id of [a, b, c, gone]) {
      await pool.query(
        `INSERT INTO time_logs (user_id, kind, scanned_at) VALUES ($1, 'in', now() - interval '1 hour')`,
        [id],
      );
    }
    await pool.query(
      `INSERT INTO time_logs (user_id, kind, scanned_at) VALUES ($1, 'out', now() - interval '5 minutes')`,
      [gone],
    );
    await logScan(lunch, a);
    await logScan(lunch, a);
    await logScan(workshop, b);

    const result = await myLiveActivities(staffId, "en");
    const byId = new Map(result.activities.map((x) => [x.activityId, x]));
    // `gone` checked out: 3 inside (a, b, c), a already ate, b and c still to eat.
    expect(byId.get(lunch)).toMatchObject({ scanned: 1, inside: 3, remaining: 2 });
    expect(byId.get(dinner)).toMatchObject({ phase: "upcoming", inside: null, remaining: null });
    expect(byId.get(workshop)).toMatchObject({ inside: null, remaining: null });
    expect(byId.get(lunch)?.labels.remaining).toBe("Still to eat");

    // A synthetic operator never sees the real-venue breakdown.
    await pool.query(`UPDATE users SET is_test_account = true WHERE id = $1`, [staffId]);
    const synthetic = await myLiveActivities(staffId, "en");
    expect(synthetic.activities.find((x) => x.activityId === lunch)).toMatchObject({
      inside: null,
      remaining: null,
    });
  });

  it("lists scannable activities in the lead window or in progress, with phase and distinct count", async () => {
    const myLiveActivities = mine;
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

    const result = await myLiveActivities(staffId, "es");
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
    const synthetic = await myLiveActivities(staffId, "es");
    expect(synthetic.activities[0]?.scanned).toBe(1);
  });
});
