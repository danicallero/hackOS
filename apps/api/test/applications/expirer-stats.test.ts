import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { pool } from "../../src/db/pool.js";
import {
  asUser,
  buildTestApp,
  createUser,
  createUserWithCapabilities,
  truncateAll,
} from "../helpers.js";
import {
  createApplication,
  createFoodIntolerance,
  createResponse,
  getResponse,
  getUserSensitive,
} from "./fixtures.js";

/** Expirer worker (plan/07 §5.2) + H27 pre-event stats. */

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
  await stopQueues();
  await closeValkey();
  await pool.end();
});

async function getApp(): Promise<App> {
  if (!app) app = await buildTestApp();
  return app;
}

describe("confirmation expirer (plan/07 §5.2)", () => {
  it("expires accepted responses past their window, keeps dietary data, one audit row, idempotent", async () => {
    const { expireDueConfirmations } = await import("../../src/modules/applications/service.js");
    const appId = await createApplication({ confirmation_window_hours: 24 });
    const userId = await createUser({ emailVerified: true });
    await pool.query(`UPDATE users SET food_intolerances = '{7}' WHERE id = $1`, [userId]);

    // accepted + sent, but decision was sent long ago (window elapsed)
    const responseId = await createResponse(userId, appId, {
      status: "accepted",
      decision_sent_at: new Date(Date.now() - 100 * 3600_000).toISOString(),
      responses: { motivation: "legacy applicant" },
    });

    const first = await expireDueConfirmations();
    expect(first.expired).toBe(1);
    expect((await getResponse(responseId)).status).toBe("expired");
    const sensitive = await getUserSensitive(userId);
    expect(sensitive.food_intolerances).toEqual([7]);

    // second pass finds nothing (idempotent)
    const second = await expireDueConfirmations();
    expect(second.expired).toBe(0);

    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM audit_log
       WHERE entity_type='application_response' AND entity_id=$1 AND action='expired'`,
      [String(responseId)],
    );
    expect(rows[0].n).toBe(1);
  });

  it("does not expire responses still inside their window", async () => {
    const { expireDueConfirmations } = await import("../../src/modules/applications/service.js");
    const appId = await createApplication({ confirmation_window_hours: 168 });
    const userId = await createUser({ emailVerified: true });
    await createResponse(userId, appId, {
      status: "accepted",
      decision_sent_at: new Date().toISOString(),
    });
    expect((await expireDueConfirmations()).expired).toBe(0);
  });
});

describe("pre-event stats (H27)", () => {
  it("counts by status + confirmed-only intolerances + field histogram", async () => {
    const a = await getApp();
    const statsUser = await createUserWithCapabilities([CAPABILITIES.LOGISTICS_STATS]);
    const appId = await createApplication({ capacity: 10 });

    const nutFree = await createFoodIntolerance("nut-free", statsUser);
    const glutenFree = await createFoodIntolerance("gluten-free", statsUser);

    // confirmed user with intolerance + shirt size — counts
    const u1 = await createUser({ emailVerified: true });
    await pool.query(`UPDATE users SET food_intolerances = $2, shirt_size = 'L' WHERE id = $1`, [
      u1,
      [nutFree],
    ]);
    await createResponse(u1, appId, {
      status: "confirmed",
      responses: { credits: "yes" },
    });
    await pool.query(
      `UPDATE application_responses SET decision_sent_at = now() - interval '5 hours', confirmed_at = now()
       WHERE user_id = $1 AND application_id = $2`,
      [u1, appId],
    );

    // another confirmed user
    const u2 = await createUser({ emailVerified: true });
    await pool.query(`UPDATE users SET food_intolerances = $2, shirt_size = 'M' WHERE id = $1`, [
      u2,
      [nutFree, glutenFree],
    ]);
    await createResponse(u2, appId, { status: "confirmed", responses: { credits: "no" } });

    // declined user (no dietary data set) — must NOT count in intolerances
    const u3 = await createUser({ emailVerified: true });
    await createResponse(u3, appId, { status: "declined", responses: { credits: "yes" } });

    // still submitted (in funnel-ish), not confirmed
    const u4 = await createUser({ emailVerified: true });
    await createResponse(u4, appId, { status: "submitted", responses: { credits: "yes" } });

    const res = await a.inject({
      method: "GET",
      url: `/api/applications/${appId}/stats?field=credits`,
      headers: asUser(statsUser),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.counts_by_status.confirmed).toBe(2);
    expect(body.counts_by_status.declined).toBe(1);
    expect(body.counts_by_status.submitted).toBe(1);

    // confirmed-only intolerances: nut-free x2, gluten-free x1 (u3 declined, excluded)
    const intoleranceMap = Object.fromEntries(
      body.food_intolerances_confirmed.map((r: { intolerance_id: number; n: number }) => [
        r.intolerance_id,
        r.n,
      ]),
    );
    expect(intoleranceMap[nutFree]).toBe(2);
    expect(intoleranceMap[glutenFree]).toBe(1);

    // shirt sizes confirmed-only
    const shirtMap = Object.fromEntries(
      body.shirt_sizes_confirmed.map((r: { value: string; n: number }) => [r.value, r.n]),
    );
    expect(shirtMap.L).toBe(1);
    expect(shirtMap.M).toBe(1);

    // field histogram across all responses (credits: yes x3, no x1)
    const histMap = Object.fromEntries(
      body.field_histogram.buckets.map((r: { value: string; n: number }) => [r.value, r.n]),
    );
    expect(histMap.yes).toBe(3);
    expect(histMap.no).toBe(1);

    // time-to-confirm computed for u1 (~5h)
    expect(body.time_to_confirm_hours.avg).toBeGreaterThan(4);
    expect(body.time_to_confirm_hours.median).toBeGreaterThan(4);
  });

  it("requires LOGISTICS_STATS", async () => {
    const a = await getApp();
    const appId = await createApplication();
    const pleb = await createUser();
    const res = await a.inject({
      method: "GET",
      url: `/api/applications/${appId}/stats`,
      headers: asUser(pleb),
    });
    expect(res.statusCode).toBe(403);
  });

  it("excludes anonymized applicants from every count (H54)", async () => {
    const a = await getApp();
    const statsUser = await createUserWithCapabilities([CAPABILITIES.LOGISTICS_STATS]);
    const admin = await createUserWithCapabilities(["*"]);
    const appId = await createApplication({ capacity: 10 });
    const nutFree = await createFoodIntolerance("nut-free", statsUser);

    const kept = await createUser({ emailVerified: true });
    await pool.query(`UPDATE users SET food_intolerances = $2, shirt_size = 'L' WHERE id = $1`, [
      kept,
      [nutFree],
    ]);
    await createResponse(kept, appId, { status: "confirmed" });
    await pool.query(
      `UPDATE application_responses SET confirmed_at = now() WHERE user_id = $1 AND application_id = $2`,
      [kept, appId],
    );

    const anonymized = await createUser({ emailVerified: true });
    await pool.query(`UPDATE users SET food_intolerances = $2, shirt_size = 'M' WHERE id = $1`, [
      anonymized,
      [nutFree],
    ]);
    await createResponse(anonymized, appId, { status: "confirmed" });
    await pool.query(
      `UPDATE application_responses SET confirmed_at = now() WHERE user_id = $1 AND application_id = $2`,
      [anonymized, appId],
    );
    // The anonymous-retention boundary is operational history, not merely an
    // application row. Give this fixture an accreditation record so the
    // endpoint exercises the real anonymization path.
    await pool.query(`UPDATE users SET badge_id = 'B-STATS-ANON' WHERE id = $1`, [anonymized]);
    await pool.query(
      `INSERT INTO check_in_logs (user_id, badge_id, staff_id)
       VALUES ($1, 'B-STATS-ANON', $2)`,
      [anonymized, admin],
    );

    const anon = await a.inject({
      method: "POST",
      url: `/api/users/${anonymized}/anonymize`,
      headers: asUser(admin),
    });
    expect(anon.statusCode).toBe(200);

    const res = await a.inject({
      method: "GET",
      url: `/api/applications/${appId}/stats`,
      headers: asUser(statsUser),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.counts_by_status.confirmed).toBe(1);
    expect(body.funnel.confirmed).toBe(1);

    const shirtMap = Object.fromEntries(
      body.shirt_sizes_confirmed.map((r: { value: string; n: number }) => [r.value, r.n]),
    );
    expect(shirtMap.L).toBe(1);
    expect(shirtMap.M).toBeUndefined();

    const intoleranceMap = Object.fromEntries(
      body.food_intolerances_confirmed.map((r: { intolerance_id: number; n: number }) => [
        r.intolerance_id,
        r.n,
      ]),
    );
    expect(intoleranceMap[nutFree]).toBe(1);
  });
});
