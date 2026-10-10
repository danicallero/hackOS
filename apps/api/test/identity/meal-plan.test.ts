import "./env.js";
import { SSE_TOPICS } from "@hackos/shared/events";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import {
  assignRole,
  asUser,
  buildTestApp,
  createRole,
  createUser,
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

async function storedPlan(userId: number): Promise<Record<number, boolean>> {
  const { rows } = await (await db()).query(
    `SELECT activity_id, attending FROM meal_attendance_plans WHERE user_id = $1`,
    [userId],
  );
  return Object.fromEntries(rows.map((r) => [r.activity_id, r.attending]));
}

describe("GET /api/me/meal-plan (#933)", () => {
  it("lists upcoming sponsor and event-wide meals only, flagging locked ones", async () => {
    const sponsor = await attendee({ sponsor: true });
    const sponsorMeal = await meal({ name: "Sponsor lunch" });
    const everyoneMeal = await meal({ name: "Dinner", audiences: [] });
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
    expect(
      body.meals.map((m: { activityId: number; locked: boolean; attending: null }) => [
        m.activityId,
        m.locked,
        m.attending,
      ]),
    ).toEqual([
      [soonMeal, true, null],
      [sponsorMeal, false, null],
      [everyoneMeal, false, null],
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
    const dinner = await meal({ audiences: [], startsInHours: 80 });

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

  it("refuses non-sponsors, non-offered meals, incomplete payloads and locked changes", async () => {
    const outsider = await attendee();
    const sponsor = await attendee({ sponsor: true });
    const lunch = await meal();
    const soon = await meal({ startsInHours: 1 });
    const participantMeal = await meal({ audiences: ["participant"] });
    const workshop = await meal({ category: "activity" });

    const forbidden = await putPlan(outsider, [{ activityId: lunch, attending: true }]);
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json().error.details.code).toBe("not_sponsor");

    for (const notOffered of [participantMeal, workshop, 999_999]) {
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

    const locked = await putPlan(sponsor, [
      { activityId: lunch, attending: true },
      { activityId: soon, attending: true },
    ]);
    expect(locked.statusCode).toBe(409);
    expect(locked.json().error.details.code).toBe("meal_plan_locked");
    expect(await storedPlan(sponsor)).toEqual({});

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

  it("serializes concurrent submissions so the stored plan is one whole payload", async () => {
    const sponsor = await attendee({ sponsor: true });
    const ids = [await meal(), await meal({ startsInHours: 90 }), await meal({ audiences: [] })];
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
      method: "POST",
      url: "/api/me/dietary/confirm",
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
      method: "POST",
      url: "/api/me/dietary/confirm",
      headers: asUser(userId),
      payload: { foodIntolerances: [], foodIntoleranceNotes: "Vegan" },
    });
    expect(changed.statusCode).toBe(409);
    expect(changed.json().error.details.code).toBe("profile_locked");

    const unchanged = await (await getApp()).inject({
      method: "POST",
      url: "/api/me/dietary/confirm",
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
