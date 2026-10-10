import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import {
  asUser,
  buildTestApp,
  createUser,
  createUserWithCapabilities,
  truncateAll,
} from "../helpers.js";

/** #933: logistics read side of sponsor meal plans and the staff correction. */

let app: App;
const HOUR = 3_600_000;

beforeEach(async () => {
  await truncateAll();
  const { valkey } = await import("../../src/lib/valkey.js");
  await valkey.flushdb();
  app ??= await buildTestApp();
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

async function db() {
  return (await import("../../src/db/pool.js")).pool;
}

async function intolerance(en: string, es: string): Promise<number> {
  const { rows } = await (await db()).query(
    `INSERT INTO food_intolerances (label) VALUES ($1) RETURNING id`,
    [{ en, es, gl: es }],
  );
  return rows[0].id;
}

async function sponsor(
  options: {
    name?: string;
    surname?: string;
    enterprise?: string;
    intolerances?: number[];
    notes?: string | null;
    testAccount?: boolean;
  } = {},
): Promise<number> {
  const pool = await db();
  const userId = await createUser({ name: options.name ?? "Ana" });
  await pool.query(
    `UPDATE users SET surname = $2, food_intolerances = $3, food_intolerance_notes = $4,
                      is_test_account = $5
      WHERE id = $1`,
    [
      userId,
      options.surname ?? "Pérez",
      options.intolerances ?? [],
      options.notes ?? null,
      options.testAccount ?? false,
    ],
  );
  const { rows } = await pool.query(`INSERT INTO enterprises (name) VALUES ($1) RETURNING id`, [
    options.enterprise ?? `Enterprise ${userId}`,
  ]);
  await pool.query(`INSERT INTO sponsors (enterprise_id, user_id) VALUES ($1, $2)`, [
    rows[0].id,
    userId,
  ]);
  return userId;
}

async function meal(
  options: {
    name?: string;
    audiences?: string[];
    startsInHours?: number;
    category?: string;
    hidden?: boolean;
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
      audiences.length === 0 || options.hidden ? "hidden" : "shown",
      audiences,
    ],
  );
  const { rows } = await pool.query(
    `INSERT INTO activities (name, category, schedule_id) VALUES ($1, $2, $3) RETURNING id`,
    [options.name ?? "Lunch", options.category ?? "meal", schedule[0].id],
  );
  return rows[0].id;
}

async function plan(userId: number, activityId: number, attending: boolean) {
  await (await db()).query(
    `INSERT INTO meal_attendance_plans (user_id, activity_id, attending) VALUES ($1, $2, $3)`,
    [userId, activityId, attending],
  );
}

describe("GET /api/logistics/meal-plans (#933)", () => {
  it("counts attending, declined and unanswered with the intolerance breakdown", async () => {
    const stats = await createUserWithCapabilities([CAPABILITIES.LOGISTICS_STATS]);
    const gluten = await intolerance("Gluten", "Gluten");
    const lactose = await intolerance("Lactose", "Lactosa");
    const lunch = await meal({ name: "Lunch" });
    const dinner = await meal({ name: "Dinner", startsInHours: 80 });
    // Not offered to sponsors: never listed.
    await meal({ name: "Participant lunch", audiences: ["participant"] });
    await meal({ name: "Talk", category: "activity" });
    // Hidden schedule entry: not offered, so not listed either.
    await meal({ name: "Hidden lunch", hidden: true });

    const a = await sponsor({ intolerances: [gluten, lactose], notes: "Severe" });
    const b = await sponsor({ intolerances: [gluten] });
    const c = await sponsor();
    await sponsor(); // never answers
    const fixture = await sponsor({ testAccount: true, intolerances: [gluten] });
    const removed = await sponsor({ intolerances: [lactose] });
    await (await db()).query(`UPDATE users SET anonymized_at = now() WHERE id = $1`, [removed]);

    await plan(a, lunch, true);
    await plan(b, lunch, true);
    await plan(c, lunch, false);
    await plan(fixture, lunch, true);
    await plan(removed, lunch, true);
    await plan(a, dinner, false);

    const res = await app.inject({
      method: "GET",
      url: "/api/logistics/meal-plans",
      headers: asUser(stats),
    });
    expect(res.statusCode).toBe(200);
    const meals = res.json().meals;
    expect(meals.map((m: { activityId: number }) => m.activityId)).toEqual([lunch, dinner]);
    expect(meals[0]).toMatchObject({
      name: "Lunch",
      attending: 2,
      notAttending: 1,
      unanswered: 1,
      withNotes: 1,
      intolerances: [
        { id: gluten, n: 2 },
        { id: lactose, n: 1, label: { en: "Lactose", es: "Lactosa", gl: "Lactosa" } },
      ],
    });
    expect(meals[1]).toMatchObject({
      attending: 0,
      notAttending: 1,
      unanswered: 3,
      intolerances: [],
      withNotes: 0,
    });

    const one = await app.inject({
      method: "GET",
      url: `/api/logistics/meal-plans?activityId=${dinner}`,
      headers: asUser(stats),
    });
    expect(one.json().meals.map((m: { activityId: number }) => m.activityId)).toEqual([dinner]);
  });

  it("counts only test accounts for a synthetic operator", async () => {
    const stats = await createUserWithCapabilities([CAPABILITIES.LOGISTICS_STATS]);
    const synthetic = await createUserWithCapabilities([CAPABILITIES.LOGISTICS_STATS]);
    await (await db()).query(`UPDATE users SET is_test_account = true WHERE id = $1`, [synthetic]);
    const lunch = await meal();
    await plan(await sponsor(), lunch, true);
    await plan(await sponsor({ testAccount: true }), lunch, false);
    await sponsor({ testAccount: true });

    const read = async (actor: number) =>
      (
        await app.inject({
          method: "GET",
          url: "/api/logistics/meal-plans",
          headers: asUser(actor),
        })
      ).json().meals[0];
    expect(await read(stats)).toMatchObject({ attending: 1, notAttending: 0, unanswered: 0 });
    expect(await read(synthetic)).toMatchObject({ attending: 0, notAttending: 1, unanswered: 1 });
  });

  it("requires logistics statistics access", async () => {
    const other = await createUserWithCapabilities([CAPABILITIES.ACTIVITY_SCAN]);
    const res = await app.inject({
      method: "GET",
      url: "/api/logistics/meal-plans",
      headers: asUser(other),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /api/logistics/meal-plans/:activityId/export.csv (#933)", () => {
  it("lists attending sponsors with enterprise, intolerances and notes", async () => {
    const exporter = await createUserWithCapabilities([CAPABILITIES.MEAL_PLANS_EXPORT]);
    const lactose = await intolerance("Lactose", "Lactosa");
    const lunch = await meal();
    const a = await sponsor({
      name: "Ana",
      surname: "Zubiri",
      enterprise: "Acme, Inc",
      intolerances: [lactose],
      notes: "No nuts",
    });
    const b = await sponsor({ name: "Bea", surname: "Alonso", enterprise: "Globex" });
    const c = await sponsor({ name: "Carla", surname: "Moreno" });
    await plan(a, lunch, true);
    await plan(b, lunch, true);
    await plan(c, lunch, false);

    const res = await app.inject({
      method: "GET",
      url: `/api/logistics/meal-plans/${lunch}/export.csv?language=en`,
      headers: asUser(exporter),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.body).toBe(
      "name,surname,enterprise,intolerances,notes\r\n" +
        "Bea,Alonso,Globex,,\r\n" +
        'Ana,Zubiri,"Acme, Inc",Lactose,No nuts\r\n',
    );
    const { rows } = await (await db()).query(
      `SELECT actor_id FROM audit_log
        WHERE entity_type = 'meal_plan_export' AND entity_id = $1 AND action = 'export'`,
      [String(lunch)],
    );
    expect(rows).toEqual([{ actor_id: exporter }]);
  });

  it("keeps the synthetic operator boundary", async () => {
    const exporter = await createUserWithCapabilities([CAPABILITIES.MEAL_PLANS_EXPORT]);
    const synthetic = await createUserWithCapabilities([CAPABILITIES.MEAL_PLANS_EXPORT]);
    await (await db()).query(`UPDATE users SET is_test_account = true WHERE id = $1`, [synthetic]);
    const lunch = await meal();
    await plan(await sponsor({ name: "Real", surname: "One" }), lunch, true);
    await plan(await sponsor({ name: "Fake", surname: "Two", testAccount: true }), lunch, true);

    const csv = async (actor: number) =>
      (
        await app.inject({
          method: "GET",
          url: `/api/logistics/meal-plans/${lunch}/export.csv`,
          headers: asUser(actor),
        })
      ).body;
    expect(await csv(exporter)).toContain("Real,One");
    expect(await csv(exporter)).not.toContain("Fake");
    expect(await csv(synthetic)).toContain("Fake,Two");
    expect(await csv(synthetic)).not.toContain("Real");
  });

  it("refuses holders of logistics:stats alone and unknown meals", async () => {
    const stats = await createUserWithCapabilities([CAPABILITIES.LOGISTICS_STATS]);
    const exporter = await createUserWithCapabilities([CAPABILITIES.MEAL_PLANS_EXPORT]);
    const lunch = await meal();
    const talk = await meal({ category: "activity" });
    const hidden = await meal({ hidden: true });

    const forbidden = await app.inject({
      method: "GET",
      url: `/api/logistics/meal-plans/${lunch}/export.csv`,
      headers: asUser(stats),
    });
    expect(forbidden.statusCode).toBe(403);

    const notMeal = await app.inject({
      method: "GET",
      url: `/api/logistics/meal-plans/${talk}/export.csv`,
      headers: asUser(exporter),
    });
    expect(notMeal.statusCode).toBe(404);

    const notOffered = await app.inject({
      method: "GET",
      url: `/api/logistics/meal-plans/${hidden}/export.csv`,
      headers: asUser(exporter),
    });
    expect(notOffered.statusCode).toBe(404);
  });
});

describe("PUT /api/users/:id/meal-plan (#933)", () => {
  function put(actor: number, userId: number, meals: object[], key?: string) {
    return app.inject({
      method: "PUT",
      url: `/api/users/${userId}/meal-plan`,
      headers: { ...asUser(actor), ...(key ? { "idempotency-key": key } : {}) },
      payload: { meals },
    });
  }

  async function auditRows(userId: number) {
    const { rows } = await (await db()).query(
      `SELECT actor_id, action, before, after FROM audit_log
        WHERE entity_type = 'user' AND entity_id = $1 AND action = 'meal_plan.updated'`,
      [String(userId)],
    );
    return rows;
  }

  it("lets meal-plans:manage correct a plan, auditing it once", async () => {
    const manager = await createUserWithCapabilities([
      CAPABILITIES.MEAL_PLANS_MANAGE,
      CAPABILITIES.USERS_READ,
    ]);
    const target = await sponsor();
    const lunch = await meal();
    const dinner = await meal({ startsInHours: 80 });
    await plan(target, lunch, true);

    const payload = [
      { activityId: lunch, attending: false },
      { activityId: dinner, attending: true },
    ];
    const res = await put(manager, target, payload, "staff-meal-1");
    expect(res.statusCode).toBe(200);
    expect(
      res.json().meals.map((m: { activityId: number; attending: boolean }) => m.attending),
    ).toEqual([false, true]);
    // Same key replayed: one write, one audit row.
    expect((await put(manager, target, payload, "staff-meal-1")).statusCode).toBe(200);

    const rows = await auditRows(target);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actor_id: manager,
      before: { attending: [lunch] },
      after: { attending: [dinner] },
    });

    const read = await app.inject({
      method: "GET",
      url: `/api/users/${target}/meal-plan`,
      headers: asUser(manager),
    });
    expect(read.statusCode).toBe(200);
    expect(read.json().meals).toHaveLength(2);

    // Unchanged answers write nothing and audit nothing.
    expect((await put(manager, target, payload)).statusCode).toBe(200);
    expect(await auditRows(target)).toHaveLength(1);
  });

  it("writes only explicit answers and leaves the sponsor's confirmation unset", async () => {
    const manager = await createUserWithCapabilities([CAPABILITIES.MEAL_PLANS_MANAGE]);
    const target = await sponsor();
    const lunch = await meal();
    const dinner = await meal({ startsInHours: 80 });

    const res = await put(manager, target, [{ activityId: lunch, attending: true }]);
    expect(res.statusCode).toBe(200);
    expect(res.json().confirmedAt).toBeNull();
    expect(
      res
        .json()
        .meals.map((m: { activityId: number; attending: boolean | null }) => [
          m.activityId,
          m.attending,
        ]),
    ).toEqual([
      [lunch, true],
      [dinner, null],
    ]);
    const { rows } = await (await db()).query(
      `SELECT meal_plan_confirmed_at FROM users WHERE id = $1`,
      [target],
    );
    expect(rows[0].meal_plan_confirmed_at).toBeNull();
  });

  it("audits staff correcting their own plan through the staff route", async () => {
    const self = await createUserWithCapabilities([CAPABILITIES.MEAL_PLANS_MANAGE]);
    const pool = await db();
    const { rows } = await pool.query(
      `INSERT INTO enterprises (name) VALUES ('Self Inc') RETURNING id`,
    );
    await pool.query(`INSERT INTO sponsors (enterprise_id, user_id) VALUES ($1, $2)`, [
      rows[0].id,
      self,
    ]);
    const lunch = await meal();

    expect((await put(self, self, [{ activityId: lunch, attending: true }])).statusCode).toBe(200);
    expect(await auditRows(self)).toEqual([
      expect.objectContaining({ actor_id: self, after: { attending: [lunch] } }),
    ]);
  });

  it("keeps business errors and capability checks", async () => {
    const manager = await createUserWithCapabilities([CAPABILITIES.MEAL_PLANS_MANAGE]);
    const usersWriter = await createUserWithCapabilities([CAPABILITIES.USERS_WRITE]);
    const target = await sponsor();
    const notSponsor = await createUser();
    const lunch = await meal();
    const locked = await meal({ startsInHours: 2 });
    await plan(target, locked, true);

    expect(
      (await put(usersWriter, target, [{ activityId: lunch, attending: true }])).statusCode,
    ).toBe(403);

    const notRep = await put(manager, notSponsor, [{ activityId: lunch, attending: true }]);
    expect(notRep.statusCode).toBe(403);
    expect(notRep.json().error.details.code).toBe("not_sponsor");

    const closed = await put(manager, target, [
      { activityId: lunch, attending: true },
      { activityId: locked, attending: false },
    ]);
    expect(closed.statusCode).toBe(409);
    expect(closed.json().error.details.code).toBe("meal_plan_locked");
    expect(await auditRows(target)).toHaveLength(0);
  });

  it("rolls the plan back when the audit write fails", async () => {
    const manager = await createUserWithCapabilities([CAPABILITIES.MEAL_PLANS_MANAGE]);
    const target = await sponsor();
    const lunch = await meal();
    const pool = await db();
    await pool.query(`
      CREATE OR REPLACE FUNCTION pg_temp_fail_meal_audit() RETURNS trigger AS $$
      BEGIN
        IF NEW.action = 'meal_plan.updated' THEN RAISE EXCEPTION 'audit down'; END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql`);
    await pool.query(`
      CREATE TRIGGER fail_meal_audit BEFORE INSERT ON audit_log
        FOR EACH ROW EXECUTE FUNCTION pg_temp_fail_meal_audit()`);
    try {
      const res = await put(manager, target, [{ activityId: lunch, attending: true }]);
      expect(res.statusCode).toBe(500);
      const { rows } = await pool.query(`SELECT 1 FROM meal_attendance_plans WHERE user_id = $1`, [
        target,
      ]);
      expect(rows).toHaveLength(0);
    } finally {
      await pool.query(`DROP TRIGGER fail_meal_audit ON audit_log`);
      await pool.query(`DROP FUNCTION pg_temp_fail_meal_audit()`);
    }
  });
});
