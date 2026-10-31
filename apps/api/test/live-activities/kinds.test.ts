import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  assignRole,
  createRole,
  createUser,
  createUserWithCapabilities,
  grantAttendeeRole,
  truncateAll,
} from "../helpers.js";
import { createRepoWithTeam } from "../queue/fixtures.js";
import {
  allowLiveActivities,
  createScannableActivity,
  openJudgingWindow,
  participantInQueue,
  resetJudgingWindow,
} from "./fixtures.js";

/**
 * #966 read model for the configurable kinds: gating (configuration, roles,
 * intrinsic capability/data), the attendee (H59), deadline (H19/H20) and
 * accreditation (H22/H24) states, H54 isolation and the per-device cut.
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
      kinds: ["queue", "attendee_activity", "activity", "accreditation", "deadline"],
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

describe("configured lead time (H25, H26, H59)", () => {
  async function setLead(minutes: number | null) {
    const pool = await db();
    await pool.query(`UPDATE live_activity_settings SET lead_minutes = $1 WHERE id = 1`, [minutes]);
  }

  it("moves when attendee and staff activities appear, without a deploy", async () => {
    const attendee = await createUser();
    const staff = await createUserWithCapabilities([CAPABILITIES.ACTIVITY_SCAN]);
    const talk = await scheduleItem({ startsInMinutes: 40 });
    await createScannableActivity({ startsInMinutes: 40 });
    await allowLiveActivities();

    // No override: the deployment default (15 min) applies.
    expect((await mine(attendee)).attendeeActivities).toEqual([]);
    expect((await mine(staff)).activities).toEqual([]);

    await setLead(60);
    expect((await mine(attendee)).attendeeActivities.map((a) => a.scheduleId)).toEqual([talk]);
    expect((await mine(staff)).activities).toHaveLength(1);

    await setLead(5);
    const near = await scheduleItem({ title: "Soon", startsInMinutes: 10 });
    expect((await mine(attendee)).attendeeActivities.map((a) => a.scheduleId)).not.toContain(near);

    // 0: only items that already started.
    await setLead(0);
    const started = await scheduleItem({ title: "Started", startsInMinutes: -1 });
    expect((await mine(attendee)).attendeeActivities.map((a) => a.scheduleId)).toEqual([started]);
  });
});

describe("configured deadline and accreditation timings (H19, H20, H22)", () => {
  async function setTimings(columns: Record<string, number | null>) {
    const pool = await db();
    await pool.query(`INSERT INTO live_activity_settings (id) VALUES (1) ON CONFLICT DO NOTHING`);
    for (const [column, value] of Object.entries(columns)) {
      await pool.query(`UPDATE live_activity_settings SET ${column} = $1 WHERE id = 1`, [value]);
    }
  }

  it("moves when the deadline activity appears without a hacking start", async () => {
    const pool = await db();
    const userId = await participant();
    await allowLiveActivities();
    await pool.query(
      `UPDATE event_config SET hacking_starts_at = NULL,
              hacking_ends_at = now() + interval '400 minutes' WHERE id = 1`,
    );
    expect((await mine(userId)).deadline).toBeNull();
    await setTimings({ deadline_lead_minutes: 500 });
    expect((await mine(userId)).deadline).toMatchObject({ kind: "deadline" });
    await setTimings({ deadline_lead_minutes: 30 });
    expect((await mine(userId)).deadline).toBeNull();
  });

  it("moves when an unsubmitted team's deadline activity turns urgent", async () => {
    const pool = await db();
    const drafter = await participant();
    const group = await pool.query<{ id: number }>(
      `INSERT INTO repos (name,created_by,submission_status) VALUES ('Rocket',$1,'draft') RETURNING id`,
      [drafter],
    );
    await pool.query(
      `INSERT INTO submissions (repo_id, user_id, status) VALUES ($1, $2, 'active')`,
      [group.rows[0]!.id, drafter],
    );
    await allowLiveActivities();
    const now = Date.now();
    await pool.query(
      `UPDATE event_config SET hacking_starts_at = $1, hacking_ends_at = $2 WHERE id = 1`,
      [new Date(now - 3_600_000), new Date(now + 40 * 60_000)],
    );
    expect((await mine(drafter)).deadline?.phase).toBe("open");
    await setTimings({ deadline_closing_minutes: 60 });
    expect((await mine(drafter)).deadline?.phase).toBe("closing");
    await setTimings({ deadline_closing_minutes: 5 });
    expect((await mine(drafter)).deadline?.phase).toBe("open");
  });

  it("moves the accreditation desk window on both sides", async () => {
    const pool = await db();
    const desk = await createUserWithCapabilities([CAPABILITIES.ACCREDIT_SCAN]);
    await allowLiveActivities();
    // Event opens in 3 h, hacking starts in 4 h: closed under the default 60 min lead.
    await pool.query(
      `UPDATE event_config SET event_starts_at = now() + interval '3 hours',
              hacking_starts_at = now() + interval '4 hours' WHERE id = 1`,
    );
    expect((await mine(desk)).accreditation).toBeNull();
    await setTimings({ accreditation_lead_minutes: 240 });
    expect((await mine(desk)).accreditation).toMatchObject({ kind: "accreditation" });

    // Hacking started 90 min ago: closed under the default 60 min tail.
    await setTimings({ accreditation_lead_minutes: null });
    await pool.query(
      `UPDATE event_config SET event_starts_at = now() - interval '3 hours',
              hacking_starts_at = now() - interval '90 minutes' WHERE id = 1`,
    );
    expect((await mine(desk)).accreditation).toBeNull();
    await setTimings({ accreditation_tail_minutes: 120 });
    expect((await mine(desk)).accreditation).toMatchObject({ kind: "accreditation" });
  });
});

describe("submission deadline (H19, H20)", () => {
  async function deadlineIn(minutes: number) {
    const pool = await db();
    // #966: use the API clock, not PostgreSQL's potentially skewed clock.
    const now = Date.now();
    await pool.query(
      `UPDATE event_config SET hacking_starts_at = $1, hacking_ends_at = $2 WHERE id = 1`,
      [new Date(now - 20 * 60 * 60_000), new Date(now + minutes * 60_000)],
    );
  }

  it("counts down for participants with event access only, for the whole hacking period", async () => {
    const pool = await db();
    const userId = await participant();
    const withoutAccess = await createUser();
    await assignRole(
      withoutAccess,
      await createRole([CAPABILITIES.QUEUE_STATUS], { eventAccess: false }),
    );
    await allowLiveActivities();

    // Hacking has not started: no countdown yet, however close the deadline.
    await pool.query(
      `UPDATE event_config SET hacking_starts_at = now() + interval '1 minute',
              hacking_ends_at = now() + interval '2 hours' WHERE id = 1`,
    );
    expect((await mine(userId)).deadline).toBeNull();

    // Hacking started: shown long before the old 3-hour lead (here 30 h out).
    await deadlineIn(30 * 60);
    expect((await mine(userId)).deadline).toMatchObject({ kind: "deadline", phase: "open" });

    // Without a start, only within LIVE_ACTIVITY_DEADLINE_LEAD_MINUTES (180).
    await pool.query(
      `UPDATE event_config SET hacking_starts_at = NULL,
              hacking_ends_at = now() + interval '400 minutes' WHERE id = 1`,
    );
    expect((await mine(userId)).deadline).toBeNull();
    await pool.query(
      `UPDATE event_config SET hacking_ends_at = now() + interval '120 minutes' WHERE id = 1`,
    );
    expect((await mine(userId)).deadline).toMatchObject({ kind: "deadline", startsAt: null });

    // Just over two hours: a few seconds under would read `1h 59m`.
    await deadlineIn(125);
    const result = await mine(userId, "gl");
    expect(result.deadline).toMatchObject({
      kind: "deadline",
      phase: "open",
      submission: null,
      projectName: null,
      url: "hackos://project",
      labels: { title: "Peche de entregas", closesIn: "Pecha en" },
      // #966: two hours left, so the widget shows `2h 5m` (one-digit minutes).
      countdownUnderHour: false,
      countdownShortMinutes: true,
      countdownUnderTenMinutes: false,
      countdownLastFiveMinutes: false,
      countdownLastMinute: false,
      countdownLastHalfMinute: false,
      countdownLastTenSeconds: false,
    });
    expect(result.deadline?.startsAt).not.toBeNull();
    expect((await mine(withoutAccess)).deadline).toBeNull();
  });

  it("tracks the project status and enters closing only for a known draft", async () => {
    const pool = await db();
    const drafter = await participant();
    const withoutProject = await participant();
    const submitter = await participant();
    const group = await pool.query<{ id: number }>(
      `INSERT INTO repos (name,created_by,submission_status) VALUES ('Rocket',$1,'draft') RETURNING id`,
      [drafter],
    );
    await pool.query(
      `INSERT INTO submissions (repo_id, user_id, status) VALUES ($1, $2, 'active')`,
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
    // #966: under an hour the flag flips, so the widget re-renders as `9m`.
    expect((await mine(drafter)).deadline?.countdownUnderHour).toBe(true);
    expect((await mine(drafter)).deadline?.countdownShortMinutes).toBe(false);
    await deadlineIn(9);
    expect((await mine(drafter)).deadline?.countdownUnderTenMinutes).toBe(true);
    expect((await mine(drafter)).deadline?.countdownLastFiveMinutes).toBe(false);
    await deadlineIn(5);
    expect((await mine(drafter)).deadline?.countdownLastFiveMinutes).toBe(true);
    expect((await mine(submitter)).deadline?.countdownLastFiveMinutes).toBe(true);
    expect((await mine(drafter)).deadline?.countdownLastMinute).toBe(false);
    // Below a minute, rather than racing the strict 60-second boundary.
    await deadlineIn(0.5);
    expect((await mine(drafter)).deadline?.countdownLastMinute).toBe(true);
    expect((await mine(submitter)).deadline?.countdownLastMinute).toBe(true);
    expect((await mine(drafter)).deadline?.countdownLastTenSeconds).toBe(false);
    await deadlineIn(0.1);
    expect((await mine(drafter)).deadline?.countdownLastTenSeconds).toBe(true);
    // H19: a participant without a project has no submission status.
    expect((await mine(withoutProject)).deadline).toMatchObject({
      phase: "open",
      submission: null,
    });
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

    // A synthetic operator counts its people finder's roster only (synthetic
    // participant fixtures, not other synthetic accounts), without presence.
    const fixture = await createUser();
    await grantAttendeeRole(fixture, "participant");
    await pool.query(`UPDATE users SET badge_id = 'B-F' WHERE id = $1`, [fixture]);
    await pool.query(`UPDATE users SET is_test_account = true WHERE id = ANY($1::int[])`, [
      [desk, fixture, people[0]],
    ]);
    expect((await mine(desk)).accreditation).toMatchObject({ accredited: 1, inside: null });
    // Without accredit:scan nothing shows, whatever the role list says.
    expect((await mine(people[2]!)).accreditation).toBeNull();
  });
});
