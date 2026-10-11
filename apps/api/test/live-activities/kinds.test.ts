import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  assignRole,
  createRole,
  createUser,
  createUserWithCapabilities,
  truncateAll,
} from "../helpers.js";
import { addChallengeJudge, createRepoWithTeam, enqueueRepo } from "../queue/fixtures.js";
import {
  allowLiveActivities,
  callEntry,
  closeJudgingWindow,
  createScannableActivity,
  openJudgingWindow,
  participantInQueue,
  resetJudgingWindow,
} from "./fixtures.js";

/**
 * #966 read model for the configurable kinds: gating (configuration, roles,
 * intrinsic capability/data), the attendee (H59), deadline (H19/H20),
 * judging (H29-H36) and accreditation (H22/H24) states, H54 isolation and
 * the per-device cut.
 */

beforeEach(async () => {
  await truncateAll();
  await resetJudgingWindow();
  const { pool } = await import("../../src/db/pool.js");
  await pool.query(
    `INSERT INTO event_config (id) VALUES (1) ON CONFLICT (id) DO UPDATE
       SET hacking_starts_at = NULL, hacking_ends_at = NULL,
           event_starts_at = NULL, event_ends_at = NULL`,
  );
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

async function mine(userId: number, language: "es" | "gl" | "en" = "en") {
  const { myLiveActivities } = await import("../../src/modules/live-activities/candidates.js");
  return myLiveActivities(userId, language);
}

async function db() {
  return (await import("../../src/db/pool.js")).pool;
}

/** A participant: queue:status through a role with event access. */
async function participant(): Promise<number> {
  const userId = await createUser();
  await assignRole(userId, await createRole([CAPABILITIES.QUEUE_STATUS], { eventAccess: true }));
  return userId;
}

async function scheduleItem(
  options: Partial<{
    title: string;
    audiences: string[];
    startsInMinutes: number;
    durationMinutes: number;
    optIn: boolean;
    visibility: "shown" | "hidden";
  }> = {},
): Promise<number> {
  const pool = await db();
  const startsIn = options.startsInMinutes ?? 10;
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO schedule (title, title_i18n, location, type, starts_at, ends_at, visibility, audiences,
                           live_activity_audience)
     VALUES ($1, '{"es":"Charla"}', 'Aula 1', 'talk',
             now() + make_interval(mins => $2), now() + make_interval(mins => $3), $4, $5, $6)
     RETURNING id`,
    [
      options.title ?? "Keynote",
      startsIn,
      startsIn + (options.durationMinutes ?? 45),
      options.visibility ?? "shown",
      options.audiences ?? ["participant"],
      options.optIn ?? true,
    ],
  );
  return rows[0]!.id;
}

describe("configuration gates", () => {
  it("needs the kind enabled, one of its roles, and the intrinsic capability", async () => {
    const pool = await db();
    const staff = await createUserWithCapabilities([CAPABILITIES.ACTIVITY_SCAN]);
    const helper = await createUser();
    await createScannableActivity({ startsInMinutes: 5 });

    // No configuration at all: fails closed.
    expect((await mine(staff)).activities).toEqual([]);

    const roleId = await allowLiveActivities();
    expect((await mine(staff)).activities).toHaveLength(1);
    // The role alone grants nothing: activity:scan is still required (H8).
    expect((await mine(helper)).activities).toEqual([]);

    await pool.query(
      `UPDATE live_activity_kind_settings SET enabled = false WHERE kind = 'activity'`,
    );
    expect((await mine(staff)).activities).toEqual([]);

    await pool.query(
      `UPDATE live_activity_kind_settings SET enabled = true WHERE kind = 'activity'`,
    );
    await pool.query(
      `DELETE FROM live_activity_kind_roles WHERE kind = 'activity' AND role_id = $1`,
      [roleId],
    );
    expect((await mine(staff)).activities).toEqual([]);

    // A soft-deleted role no longer counts.
    await pool.query(
      `INSERT INTO live_activity_kind_roles (kind, role_id) VALUES ('activity', $1)`,
      [roleId],
    );
    await pool.query(`UPDATE roles SET deleted_at = now() WHERE id = $1`, [roleId]);
    expect((await mine(staff)).activities).toEqual([]);
  });

  it("ranks kinds by priority and cuts the set to maxConcurrent", async () => {
    await openJudgingWindow();
    const { userId } = await participantInQueue();
    await scheduleItem({ startsInMinutes: 5 });
    await scheduleItem({ title: "Later", startsInMinutes: 8 });

    await allowLiveActivities({ maxConcurrent: 2 });
    let result = await mine(userId);
    // Attendee items outrank the queue by default: two slots, both theirs.
    expect(result.attendeeActivities.map((a) => a.rank)).toEqual([0, 1]);
    expect(result.queue).toBeNull();

    await allowLiveActivities({
      maxConcurrent: 2,
      kinds: ["queue", "attendee_activity", "activity", "judging", "accreditation", "deadline"],
    });
    result = await mine(userId);
    expect(result.queue?.rank).toBe(0);
    expect(result.attendeeActivities.map((a) => [a.name, a.rank])).toEqual([["Keynote", 1]]);
  });
});

describe("attendee activity (H59)", () => {
  it("follows the schedule audience, visibility and opt-in", async () => {
    const pool = await db();
    const attendee = await createUser();
    const sponsorRep = await createUser();
    const enterprise = await pool.query<{ id: number }>(
      `INSERT INTO enterprises (name) VALUES ('Acme') RETURNING id`,
    );
    await pool.query(`INSERT INTO sponsors (enterprise_id, user_id) VALUES ($1, $2)`, [
      enterprise.rows[0]!.id,
      sponsorRep,
    ]);
    const talk = await scheduleItem({ startsInMinutes: 5 });
    const live = await scheduleItem({ title: "Live", startsInMinutes: -5 });
    const sponsorsOnly = await scheduleItem({ title: "Sponsors", audiences: ["sponsor"] });
    await scheduleItem({ title: "Not opted in", optIn: false });
    await scheduleItem({ title: "Draft", visibility: "hidden", audiences: [] });
    await scheduleItem({ title: "Too far", startsInMinutes: 40 });
    await allowLiveActivities();

    const result = await mine(attendee, "es");
    expect(result.attendeeActivities.map((a) => a.scheduleId)).toEqual([live, talk]);
    expect(result.attendeeActivities[1]).toMatchObject({
      kind: "attendee_activity",
      phase: "upcoming",
      name: "Charla",
      location: "Aula 1",
      category: "talk",
      url: `hackos://schedule/${talk}`,
      labels: { startsIn: "Empieza en", now: "Ahora", endsIn: "Acaba en" },
    });
    expect(result.attendeeActivities[0]?.phase).toBe("live");

    const rep = await mine(sponsorRep);
    expect(rep.attendeeActivities.map((a) => a.scheduleId)).toContain(sponsorsOnly);
  });
});

describe("submission deadline (H19, H20)", () => {
  async function deadlineIn(minutes: number) {
    const pool = await db();
    await pool.query(
      `UPDATE event_config SET hacking_starts_at = now() - interval '20 hours',
              hacking_ends_at = now() + make_interval(mins => $1) WHERE id = 1`,
      [minutes],
    );
  }

  it("counts down for participants with event access only, within the lead time", async () => {
    const userId = await participant();
    const withoutAccess = await createUser();
    await assignRole(
      withoutAccess,
      await createRole([CAPABILITIES.QUEUE_STATUS], { eventAccess: false }),
    );
    await allowLiveActivities();

    await deadlineIn(400);
    expect((await mine(userId)).deadline).toBeNull();

    await deadlineIn(120);
    const result = await mine(userId, "gl");
    expect(result.deadline).toMatchObject({
      kind: "deadline",
      phase: "open",
      submission: null,
      projectName: null,
      url: "hackos://project",
      labels: { title: "Peche de entregas", closesIn: "Pecha en" },
    });
    expect(result.deadline?.startsAt).not.toBeNull();
    expect((await mine(withoutAccess)).deadline).toBeNull();
  });

  it("tracks the project status and enters closing only for a known draft", async () => {
    const pool = await db();
    const drafter = await participant();
    const devpostOnly = await participant();
    const submitter = await participant();
    const group = await pool.query<{ id: number }>(
      `INSERT INTO planned_work_groups (name, created_by) VALUES ('Rocket', $1) RETURNING id`,
      [drafter],
    );
    await pool.query(
      `INSERT INTO planned_work_group_members (group_id, user_id, status) VALUES ($1, $2, 'active')`,
      [group.rows[0]!.id, drafter],
    );
    const { repoId } = await createRepoWithTeam([submitter], "Shipped");
    await pool.query(`UPDATE repos SET submission_status = 'submitted' WHERE id = $1`, [repoId]);
    await allowLiveActivities();

    await deadlineIn(60);
    expect((await mine(drafter)).deadline).toMatchObject({
      phase: "open",
      submission: "draft",
      projectName: "Rocket",
    });
    expect((await mine(submitter)).deadline).toMatchObject({
      phase: "submitted",
      submission: "submitted",
      projectName: "Shipped",
    });

    await deadlineIn(10);
    expect((await mine(drafter)).deadline?.phase).toBe("closing");
    // Unknown status (Devpost-only, not imported) never claims "not submitted".
    expect((await mine(devpostOnly)).deadline).toMatchObject({ phase: "open", submission: null });
  });
});

describe("judging room (H29-H36)", () => {
  it("shows the judge's room with the pitch timer, the next team and the waiting count", async () => {
    const pool = await db();
    await openJudgingWindow();
    const { entryId, challengeId, roomId } = await participantInQueue({ position: 1 });
    const judge = await createUser();
    await addChallengeJudge(challengeId, judge);
    const outsider = await createUserWithCapabilities([CAPABILITIES.JUDGE_PANEL]);
    const { repoId: nextRepo } = await createRepoWithTeam(undefined, "Next team");
    const nextEntry = await enqueueRepo(challengeId, nextRepo, 2);
    const { repoId: waitingRepo } = await createRepoWithTeam();
    await enqueueRepo(challengeId, waitingRepo, 3);
    await pool.query(`UPDATE challenges SET max_presentation_seconds = 300 WHERE id = $1`, [
      challengeId,
    ]);
    await allowLiveActivities();

    // Room open, nobody called yet.
    expect((await mine(judge)).judging).toMatchObject([
      { phase: "idle", roomId, current: null, next: null, waitingCount: 3 },
    ]);

    await pool.query(
      `UPDATE queue_entries SET status = 'presenting', assigned_room_id = $2,
              called_at = now() - interval '10 minutes', room_entered_at = now() - interval '6 minutes',
              presentation_started_at = now() - interval '4 minutes',
              presentation_paused_at = now() - interval '1 minute', presentation_paused_seconds = 20
        WHERE id = $1`,
      [entryId, roomId],
    );
    await callEntry(nextEntry, roomId);
    const [room] = (await mine(judge, "es")).judging;
    expect(room).toMatchObject({
      kind: "judging",
      phase: "presenting",
      roomName: "Room B",
      roomLocation: "Floor 2",
      roomPaused: false,
      current: {
        entryId,
        status: "presenting",
        presentationPausedSeconds: 20,
        presentationSeconds: 300,
      },
      next: { entryId: nextEntry, name: "Next team" },
      calledCount: 1,
      waitingCount: 1,
      url: `hackos://judging?room=${roomId}`,
      labels: { presenting: "Presentando", next: "Siguiente" },
    });
    expect(room?.current?.presentationStartedAt).not.toBeNull();
    expect(room?.current?.presentationPausedAt).not.toBeNull();

    // judge:panel without a room association has no room of their own.
    expect((await mine(outsider)).judging).toEqual([]);
    // A synthetic judge never sees a real room (H54).
    await pool.query(`UPDATE users SET is_test_account = true WHERE id = $1`, [judge]);
    expect((await mine(judge)).judging).toEqual([]);
    await pool.query(`UPDATE users SET is_test_account = false WHERE id = $1`, [judge]);

    await closeJudgingWindow();
    expect((await mine(judge)).judging).toEqual([]);
  });

  it("drops a paused room with nobody inside or called (H35)", async () => {
    const pool = await db();
    await openJudgingWindow();
    const { challengeId, roomId } = await participantInQueue();
    const judge = await createUser();
    await addChallengeJudge(challengeId, judge);
    await pool.query(`UPDATE room_queue_state SET is_paused = true WHERE room_id = $1`, [roomId]);
    await allowLiveActivities();
    expect((await mine(judge)).judging).toEqual([]);
  });
});

describe("accreditation desk (H22, H24)", () => {
  it("shows accredited/eligible, recent arrivals and presence inside its window", async () => {
    const pool = await db();
    const desk = await createUserWithCapabilities([CAPABILITIES.ACCREDIT_SCAN]);
    const attendeeRole = await createRole([], { eventAccess: true });
    const people = [await createUser(), await createUser(), await createUser()];
    for (const id of people) await assignRole(id, attendeeRole);
    await pool.query(`UPDATE users SET badge_id = 'B-' || id WHERE id = ANY($1::int[])`, [
      people.slice(0, 2),
    ]);
    // Set separately: assigning a badge stamps badge_assigned_at itself.
    await pool.query(
      `UPDATE users SET badge_assigned_at = now() - interval '30 minutes' WHERE id = $1`,
      [people[1]],
    );
    await pool.query(
      `INSERT INTO time_logs (user_id, kind, scanned_at) VALUES ($1, 'in', now() - interval '1 minute')`,
      [people[0]],
    );
    await allowLiveActivities();

    expect((await mine(desk)).accreditation).toBeNull();
    await pool.query(
      `UPDATE event_config SET event_starts_at = now() + interval '30 minutes',
              hacking_starts_at = now() + interval '2 hours' WHERE id = 1`,
    );
    const result = await mine(desk);
    // The desk's own role (createUserWithCapabilities) also grants event access.
    expect(result.accreditation).toMatchObject({
      kind: "accreditation",
      phase: "live",
      accredited: 2,
      eligible: 4,
      recentArrivals: 1,
      inside: 1,
      scanUrl: "hackos://scan",
    });

    // A synthetic operator counts synthetic subjects only, without presence.
    await pool.query(`UPDATE users SET is_test_account = true WHERE id = $1`, [desk]);
    expect((await mine(desk)).accreditation).toMatchObject({
      accredited: 0,
      eligible: 1,
      inside: null,
    });
    // Without accredit:scan nothing shows, whatever the role list says.
    expect((await mine(people[2]!)).accreditation).toBeNull();
  });
});
