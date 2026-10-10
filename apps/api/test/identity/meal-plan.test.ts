import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import {
  assignRole,
  asUser,
  buildTestApp,
  createRole,
  createUser,
  createUserWithCapabilities,
  truncateAll,
} from "../helpers.js";

/** #933: sponsor meal plans, explicit dietary confirmation and pendingProfileTasks. */

let app: App;

beforeEach(async () => {
  await truncateAll();
  const { valkey } = await import("../../src/lib/valkey.js");
  await valkey.flushdb();
});

afterAll(async () => {
  await app?.close();
  const { stopQueues } = await import("../../src/lib/queues.js");
  const { closeValkey } = await import("../../src/lib/valkey.js");
  const { pool } = await import("../../src/db/pool.js");
  await stopQueues();
  await closeValkey();
  await pool.end();
});

async function getApp(): Promise<App> {
  if (!app) app = await buildTestApp();
  return app;
}

async function db() {
  return (await import("../../src/db/pool.js")).pool;
}

const HOUR = 3_600_000;

/** A user with event access (an event-bearing role), optionally a sponsor rep. */
async function attendee(options: { sponsor?: boolean } = {}): Promise<number> {
  const userId = await createUser();
  await assignRole(userId, await createRole([], { eventAccess: true }));
  if (options.sponsor) {
    const pool = await db();
    const { rows } = await pool.query(`INSERT INTO enterprises (name) VALUES ($1) RETURNING id`, [
      `Enterprise ${userId}`,
    ]);
    await pool.query(`INSERT INTO sponsors (enterprise_id, user_id) VALUES ($1, $2)`, [
      rows[0].id,
      userId,
    ]);
  }
  return userId;
}

async function meal(
  options: {
    startsInHours?: number;
    audiences?: string[];
    visibility?: "shown" | "hidden";
    category?: string;
    name?: string;
  } = {},
): Promise<number> {
  const pool = await db();
  const startsAt = new Date(Date.now() + (options.startsInHours ?? 72) * HOUR);
  const audiences = options.audiences ?? ["sponsor"];
  const { rows: schedule } = await pool.query(
    `INSERT INTO schedule (title, starts_at, ends_at, visibility, audiences)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [
      options.name ?? "Lunch",
      startsAt,
      new Date(startsAt.getTime() + HOUR),
      audiences.length === 0 ? "hidden" : (options.visibility ?? "shown"),
      audiences,
    ],
  );
  const { rows } = await pool.query(
    `INSERT INTO activities (name, category, schedule_id) VALUES ($1, $2, $3) RETURNING id`,
    [options.name ?? "Lunch", options.category ?? "meal", schedule[0].id],
  );
  return rows[0].id;
}

async function me(userId: number) {
  const res = await (await getApp()).inject({
    method: "GET",
    url: "/api/me",
    headers: asUser(userId),
  });
  expect(res.statusCode).toBe(200);
  return res.json();
}

function putPlan(
  userId: number,
  meals: { activityId: number; attending: boolean }[],
  key?: string,
) {
  return getApp().then((a) =>
    a.inject({
      method: "PUT",
      url: "/api/me/meal-plan",
      headers: { ...asUser(userId), ...(key ? { "idempotency-key": key } : {}) },
      payload: { meals },
    }),
  );
}

/** Collects the logistics-topic events published while `run` executes. */
async function logisticsEvents(
  run: () => Promise<unknown>,
): Promise<{ type: string; data: unknown }[]> {
  const { valkey } = await import("../../src/lib/valkey.js");
  const { config } = await import("../../src/config.js");
  const sub = valkey.duplicate({ enableOfflineQueue: true });
  const events: { type: string; data: unknown }[] = [];
  sub.on("message", (_channel: string, message: string) => {
    const line = message.split("\n").find((l) => l.startsWith("data: "));
    if (line) events.push(JSON.parse(line.slice("data: ".length)));
  });
  await sub.subscribe(`sse:${config.SSE_NAMESPACE}:${SSE_TOPICS.LOGISTICS}`);
  try {
    await run();
    await new Promise((resolve) => setTimeout(resolve, 100));
  } finally {
    await sub.quit();
  }
  return events;
}

async function storedPlan(userId: number): Promise<Record<number, boolean>> {
  const { rows } = await (await db()).query(
    `SELECT activity_id, attending FROM meal_attendance_plans WHERE user_id = $1`,
    [userId],
  );
  return Object.fromEntries(rows.map((r) => [r.activity_id, r.attending]));
}

describe("GET /api/me/meal-plan (#933)", () => {
  it("lists upcoming sponsor meals only, flagging locked ones", async () => {
    const sponsor = await attendee({ sponsor: true });
    const sponsorMeal = await meal({ name: "Sponsor lunch" });
    const sharedMeal = await meal({ name: "Dinner", audiences: ["participant", "sponsor"] });
    // No audiences means staff-only in the schedule: never offered to sponsors.
    await meal({ name: "Staff dinner", audiences: [] });
    const soonMeal = await meal({ name: "Breakfast", startsInHours: 2 });
    await meal({ name: "Participant lunch", audiences: ["participant"] });
    await meal({ name: "Unpublished", visibility: "hidden" });
    await meal({ name: "Workshop", category: "activity" });
    await meal({ name: "Past", startsInHours: -5 });

    const res = await (await getApp()).inject({
      method: "GET",
      url: "/api/me/meal-plan",
      headers: asUser(sponsor),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.confirmedAt).toBeNull();
    expect(body.cutoffHours).toBe(24);
    expect(
      body.meals.map((m: { activityId: number; locked: boolean; attending: null }) => [
        m.activityId,
        m.locked,
        m.attending,
      ]),
    ).toEqual([
      [soonMeal, true, null],
      [sponsorMeal, false, null],
      [sharedMeal, false, null],
    ]);
  });

  it("rejects a caller who is not a sponsor representative", async () => {
    const userId = await attendee();
    const res = await (await getApp()).inject({
      method: "GET",
      url: "/api/me/meal-plan",
      headers: asUser(userId),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.details.code).toBe("not_sponsor");
  });
});

describe("PUT /api/me/meal-plan (#933)", () => {
  it("stores the whole plan and reflects it on GET", async () => {
    const sponsor = await attendee({ sponsor: true });
    const lunch = await meal();
    const dinner = await meal({ startsInHours: 80 });

    const res = await putPlan(sponsor, [
      { activityId: lunch, attending: true },
      { activityId: dinner, attending: false },
    ]);
    expect(res.statusCode).toBe(200);
    expect(res.json().confirmedAt).not.toBeNull();
    expect(await storedPlan(sponsor)).toEqual({ [lunch]: true, [dinner]: false });

    const get = await (await getApp()).inject({
      method: "GET",
      url: "/api/me/meal-plan",
      headers: asUser(sponsor),
    });
    expect(get.json().meals.map((m: { attending: boolean }) => m.attending)).toEqual([true, false]);
  });

  it("refuses non-sponsors, non-meal ids, incomplete payloads and locked changes", async () => {
    const outsider = await attendee();
    const sponsor = await attendee({ sponsor: true });
    const lunch = await meal();
    const soon = await meal({ startsInHours: 1 });
    const workshop = await meal({ category: "activity" });

    const forbidden = await putPlan(outsider, [{ activityId: lunch, attending: true }]);
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json().error.details.code).toBe("not_sponsor");

    for (const notOffered of [workshop, 999_999]) {
      const res = await putPlan(sponsor, [
        { activityId: lunch, attending: true },
        { activityId: notOffered, attending: true },
      ]);
      expect(res.statusCode).toBe(400);
      expect(res.json().error.details.code).toBe("meal_not_offered");
    }

    const incomplete = await putPlan(sponsor, []);
    expect(incomplete.statusCode).toBe(400);
    expect(incomplete.json().error.details.code).toBe("meal_plan_incomplete");

    // A locked meal that was never answered is ignored, not refused.
    const unansweredLocked = await putPlan(sponsor, [
      { activityId: lunch, attending: true },
      { activityId: soon, attending: true },
    ]);
    expect(unansweredLocked.statusCode).toBe(200);
    expect(await storedPlan(sponsor)).toEqual({ [lunch]: true });

    // Omitting a locked meal is fine.
    const ok = await putPlan(sponsor, [{ activityId: lunch, attending: false }]);
    expect(ok.statusCode).toBe(200);

    // Once lunch locks, echoing its stored answer passes; changing it does not.
    await (await db()).query(
      `UPDATE schedule SET starts_at = now() + interval '1 hour', ends_at = now() + interval '2 hours'
        WHERE id = (SELECT schedule_id FROM activities WHERE id = $1)`,
      [lunch],
    );
    expect((await putPlan(sponsor, [{ activityId: lunch, attending: false }])).statusCode).toBe(
      200,
    );
    const relocked = await putPlan(sponsor, [{ activityId: lunch, attending: true }]);
    expect(relocked.statusCode).toBe(409);
    expect(relocked.json().error.details.code).toBe("meal_plan_locked");
    expect(await storedPlan(sponsor)).toEqual({ [lunch]: false });
  });

  it("ignores meals that ended or stopped being offered since the list was loaded", async () => {
    const sponsor = await attendee({ sponsor: true });
    const lunch = await meal();
    const ended = await meal({ startsInHours: -5 });
    const withdrawn = await meal({ audiences: ["participant"] });
    const staffOnly = await meal({ audiences: [] });

    const res = await putPlan(sponsor, [
      { activityId: lunch, attending: true },
      { activityId: ended, attending: true },
      { activityId: withdrawn, attending: true },
      { activityId: staffOnly, attending: false },
    ]);
    expect(res.statusCode).toBe(200);
    expect(res.json().meals.map((m: { activityId: number }) => m.activityId)).toEqual([lunch]);
    expect(await storedPlan(sponsor)).toEqual({ [lunch]: true });
  });

  it("broadcasts only the meals whose answer changed, and nothing when none did", async () => {
    const sponsor = await attendee({ sponsor: true });
    const lunch = await meal();
    const dinner = await meal({ startsInHours: 80 });

    const first = await logisticsEvents(() =>
      putPlan(sponsor, [
        { activityId: lunch, attending: true },
        { activityId: dinner, attending: true },
      ]),
    );
    expect(first).toEqual([
      expect.objectContaining({
        type: EVENTS.LOGISTICS_MEAL_PLAN_UPDATED,
        data: { activityIds: [lunch, dinner] },
      }),
    ]);

    const second = await logisticsEvents(() =>
      putPlan(sponsor, [
        { activityId: lunch, attending: true },
        { activityId: dinner, attending: false },
      ]),
    );
    expect(second.map((e) => e.data)).toEqual([{ activityIds: [dinner] }]);

    const unchanged = await logisticsEvents(() =>
      putPlan(sponsor, [
        { activityId: lunch, attending: true },
        { activityId: dinner, attending: false },
      ]),
    );
    expect(unchanged).toEqual([]);
  });

  it("serializes concurrent submissions so the stored plan is one whole payload", async () => {
    const sponsor = await attendee({ sponsor: true });
    const ids = [
      await meal(),
      await meal({ startsInHours: 90 }),
      await meal({ startsInHours: 100 }),
    ];
    const a = ids.map((activityId) => ({ activityId, attending: true }));
    const b = ids.map((activityId) => ({ activityId, attending: false }));

    for (let round = 0; round < 5; round += 1) {
      const results = await Promise.all([putPlan(sponsor, a), putPlan(sponsor, b)]);
      expect(results.map((r) => r.statusCode)).toEqual([200, 200]);
      const values = new Set(Object.values(await storedPlan(sponsor)));
      expect(values.size).toBe(1);
    }
  });

  it("replays an Idempotency-Key without a second write or broadcast", async () => {
    const sponsor = await attendee({ sponsor: true });
    const lunch = await meal();
    const key = crypto.randomUUID();

    const first = await putPlan(sponsor, [{ activityId: lunch, attending: true }], key);
    expect(first.statusCode).toBe(200);
    const { rows: before } = await (await db()).query(
      `SELECT updated_at FROM meal_attendance_plans WHERE user_id = $1`,
      [sponsor],
    );
    const replay = await putPlan(sponsor, [{ activityId: lunch, attending: true }], key);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(first.json());
    const { rows: after } = await (await db()).query(
      `SELECT updated_at FROM meal_attendance_plans WHERE user_id = $1`,
      [sponsor],
    );
    expect(after).toEqual(before);

    // The logistics topic sequence advanced exactly once for the two calls.
    const { broadcast } = await import("../../src/lib/sse.js");
    const probe = await broadcast(SSE_TOPICS.LOGISTICS, "test.probe", {});
    expect(Number(probe?.id)).toBe(2);
  });
});

describe("dietary confirmation and pendingProfileTasks (#933)", () => {
  it("asks event-access accounts for dietary data until they answer, even with none", async () => {
    const userId = await attendee();
    expect((await me(userId)).pendingProfileTasks).toEqual(["dietary"]);

    const res = await (await getApp()).inject({
      method: "PATCH",
      url: "/api/me",
      headers: asUser(userId),
      payload: { foodIntolerances: [], foodIntoleranceNotes: null },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().dietaryConfirmedAt).not.toBeNull();
    expect(res.json().dietaryDataState).toBe("not_provided");
    expect((await me(userId)).pendingProfileTasks).toEqual([]);
  });

  it("does not ask accounts without event access", async () => {
    const userId = await createUser();
    expect((await me(userId)).pendingProfileTasks).toEqual([]);
  });

  it("does not count a staff edit of someone else's dietary data", async () => {
    const userId = await attendee();
    const staff = await createUserWithCapabilities([CAPABILITIES.USERS_WRITE]);
    const res = await (await getApp()).inject({
      method: "PATCH",
      url: `/api/users/${userId}`,
      headers: asUser(staff),
      payload: { foodIntoleranceNotes: "Vegan" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().dietaryDataState).toBe("present");
    expect(res.json().dietaryConfirmedAt).toBeNull();
    expect((await me(userId)).pendingProfileTasks).toEqual(["dietary"]);
  });

  it("counts a PATCH /api/me dietary save as an answer", async () => {
    const userId = await attendee();
    const pool = await db();
    const { rows } = await pool.query(
      `INSERT INTO food_intolerances (label) VALUES ('{"en": "Gluten"}'::jsonb) RETURNING id`,
    );
    const res = await (await getApp()).inject({
      method: "PATCH",
      url: "/api/me",
      headers: asUser(userId),
      payload: { foodIntolerances: [rows[0].id] },
    });
    expect(res.statusCode).toBe(200);
    expect((await me(userId)).pendingProfileTasks).toEqual([]);
  });

  it("keeps the H7 lock: changing values after an accepted application is refused", async () => {
    const userId = await attendee();
    const pool = await db();
    const { rows: apps } = await pool.query(
      `INSERT INTO applications (name, template) VALUES ('Hack', '[]'::jsonb) RETURNING id`,
    );
    const { ensureApplicationFormVersion } = await import("../helpers.js");
    const versionId = await ensureApplicationFormVersion(apps[0].id);
    await pool.query(
      `INSERT INTO application_responses
         (application_id, user_id, status, application_form_version_id)
       VALUES ($1, $2, 'accepted', $3)`,
      [apps[0].id, userId, versionId],
    );
    const changed = await (await getApp()).inject({
      method: "PATCH",
      url: "/api/me",
      headers: asUser(userId),
      payload: { foodIntolerances: [], foodIntoleranceNotes: "Vegan" },
    });
    expect(changed.statusCode).toBe(409);
    expect(changed.json().error.details.code).toBe("profile_locked");

    const unchanged = await (await getApp()).inject({
      method: "PATCH",
      url: "/api/me",
      headers: asUser(userId),
      payload: { foodIntolerances: [], foodIntoleranceNotes: null },
    });
    expect(unchanged.statusCode).toBe(200);
  });

  it("asks sponsors for a meal plan until every open meal is answered, and again for a new meal", async () => {
    const sponsor = await attendee({ sponsor: true });
    await (await db()).query(`UPDATE users SET dietary_confirmed_at = now() WHERE id = $1`, [
      sponsor,
    ]);
    expect((await me(sponsor)).pendingProfileTasks).toEqual([]);

    const lunch = await meal();
    expect((await me(sponsor)).pendingProfileTasks).toEqual(["meal_plan"]);
    expect((await putPlan(sponsor, [{ activityId: lunch, attending: true }])).statusCode).toBe(200);
    expect((await me(sponsor)).pendingProfileTasks).toEqual([]);

    await meal({ startsInHours: 100 });
    expect((await me(sponsor)).pendingProfileTasks).toEqual(["meal_plan"]);

    // A locked, unanswered meal can no longer be answered — it does not nag.
    await (await db()).query(`DELETE FROM activities WHERE id <> $1`, [lunch]);
    await meal({ startsInHours: 3 });
    expect((await me(sponsor)).pendingProfileTasks).toEqual([]);
  });
});

describe("dietary confirmation backfill (#933, migration 0502)", () => {
  it("confirms users with dietary data or a submitted application that asked for it", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync(
      new URL("../../db/migrations/0502_sponsor_meal_attendance.sql", import.meta.url),
      "utf8",
    );
    const backfill = sql.match(/UPDATE public\.users u SET dietary_confirmed_at[\s\S]*?;\n/)?.[0];
    expect(backfill).toBeDefined();

    const pool = await db();
    const { ensureApplicationFormVersion } = await import("../helpers.js");
    const withData = await createUser();
    const askedEmpty = await createUser();
    const askedDraft = await createUser();
    const notAsked = await createUser();
    await createUser(); // never answered anything
    await pool.query(
      `UPDATE users SET dietary_data_state = 'present', food_intolerance_notes = 'Vegan'
        WHERE id = $1`,
      [withData],
    );
    const { rows: apps } = await pool.query(
      `INSERT INTO applications (name, template, ask_food_intolerances)
       VALUES ('Asks', '[]'::jsonb, true), ('Silent', '[]'::jsonb, false) RETURNING id`,
    );
    const asks: number = apps[0].id;
    const silent: number = apps[1].id;
    for (const [applicationId, userId, submitted] of [
      [asks, askedEmpty, true],
      [asks, askedDraft, false],
      [silent, notAsked, true],
    ] as const) {
      await pool.query(
        `INSERT INTO application_responses
           (application_id, user_id, status, application_form_version_id, submitted_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          applicationId,
          userId,
          submitted ? "review" : "draft",
          await ensureApplicationFormVersion(applicationId),
          submitted ? new Date() : null,
        ],
      );
    }

    await pool.query(backfill as string);
    const { rows } = await pool.query(
      `SELECT id FROM users WHERE dietary_confirmed_at IS NOT NULL ORDER BY id`,
    );
    expect(rows.map((row) => row.id)).toEqual([withData, askedEmpty]);
  });
});

describe("meal plan cutoff setting (#933)", () => {
  it("reads and saves mealPlanCutoffHours with validation and an audit row", async () => {
    const a = await getApp();
    const manager = await createUserWithCapabilities([CAPABILITIES.INTOLERANCES_MANAGE]);
    const put = await a.inject({
      method: "PUT",
      url: "/api/event",
      headers: { ...asUser(manager), "idempotency-key": crypto.randomUUID() },
      payload: { mealPlanCutoffHours: 48 },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().mealPlanCutoffHours).toBe(48);
    const get = await a.inject({ method: "GET", url: "/api/event", headers: asUser(manager) });
    expect(get.json().mealPlanCutoffHours).toBe(48);

    const pool = await db();
    const { rows } = await pool.query(
      `SELECT after FROM audit_log WHERE entity_type = 'event_config' ORDER BY id DESC LIMIT 1`,
    );
    expect(rows[0].after.mealPlanCutoffHours).toBe(48);

    // A 48 h cutoff locks a meal 30 h away.
    const sponsor = await attendee({ sponsor: true });
    await meal({ startsInHours: 30 });
    const plan = await a.inject({
      method: "GET",
      url: "/api/me/meal-plan",
      headers: asUser(sponsor),
    });
    expect(plan.json().meals[0].locked).toBe(true);
    expect(plan.json().cutoffHours).toBe(48);

    for (const bad of [-1, 169, 1.5]) {
      const res = await a.inject({
        method: "PUT",
        url: "/api/event",
        headers: { ...asUser(manager), "idempotency-key": crypto.randomUUID() },
        payload: { mealPlanCutoffHours: bad },
      });
      expect(res.statusCode).toBe(400);
    }

    const outsider = await createUserWithCapabilities([CAPABILITIES.VENUE_MANAGE]);
    const forbidden = await a.inject({
      method: "PUT",
      url: "/api/event",
      headers: { ...asUser(outsider), "idempotency-key": crypto.randomUUID() },
      payload: { mealPlanCutoffHours: 12 },
    });
    expect(forbidden.statusCode).toBe(403);
  });
});

describe("meal plan privacy (#933, H54)", () => {
  it("deletes the sponsor's meal plan when the account is anonymized", async () => {
    const sponsor = await attendee({ sponsor: true });
    const staff = await createUser();
    const lunch = await meal();
    expect((await putPlan(sponsor, [{ activityId: lunch, attending: true }])).statusCode).toBe(200);
    const pool = await db();
    // Operational history forces anonymization rather than plain deletion.
    await pool.query(`UPDATE users SET badge_id = 'B-MEAL-PLAN' WHERE id = $1`, [sponsor]);
    await pool.query(
      `INSERT INTO check_in_logs (user_id, badge_id, staff_id) VALUES ($1, 'B-MEAL-PLAN', $2)`,
      [sponsor, staff],
    );

    const { runAccountRemoval } = await import("../../src/modules/identity/removal.js");
    await expect(
      runAccountRemoval({
        targetId: sponsor,
        actorId: null,
        source: "system",
        requestedAction: "anonymize",
      }),
    ).resolves.toMatchObject({ status: "completed", anonymized: true });
    expect((await pool.query(`SELECT 1 FROM meal_attendance_plans`)).rowCount).toBe(0);
  });
});
