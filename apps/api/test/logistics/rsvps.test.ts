import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import {
  assignRole,
  asUser,
  buildTestApp,
  createRole,
  createUser,
  createUserWithCapabilities,
  grantAttendeeRole,
  truncateAll,
} from "../helpers.js";
import { seedEventConfig } from "../rsvp-helpers.js";

/** Per-activity RSVPs: eligibility, answers, locks, editions and counts. */

let app: App;
const HOUR = 3_600_000;

async function db() {
  return (await import("../../src/db/pool.js")).pool;
}

beforeEach(async () => {
  await truncateAll();
  await seedEventConfig(await db());
  const { valkey } = await import("../../src/lib/valkey.js");
  await valkey.flushdb();
  app ??= await buildTestApp();
});

afterAll(async () => {
  await app?.close();
});

type Kind = "participant" | "mentor" | "sponsor" | "staff";

/** A user whose derived attendance kind is `kind` (participant-first). */
async function person(kind: Kind | null, extra: { alsoSponsor?: boolean } = {}): Promise<number> {
  const userId = await createUser();
  const pool = await db();
  if (kind === null) return userId;
  if (kind === "participant") await grantAttendeeRole(userId, "participant");
  if (kind === "mentor") await grantAttendeeRole(userId, "mentor");
  if (kind === "staff") await assignRole(userId, await createRole([], { eventAccess: true }));
  if (kind === "sponsor" || extra.alsoSponsor) {
    // Sponsors, like everyone else, only exist for the edition with event access.
    if (kind === "sponsor") await assignRole(userId, await createRole([], { eventAccess: true }));
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

async function activity(
  options: {
    category?: string;
    startsInHours?: number;
    hidden?: boolean;
    kinds?: Kind[];
    enabled?: boolean;
    closesInHours?: number;
  } = {},
): Promise<number> {
  const pool = await db();
  const startsAt = new Date(Date.now() + (options.startsInHours ?? 72) * HOUR);
  const { rows: schedule } = await pool.query(
    `INSERT INTO schedule (title, starts_at, ends_at, visibility, audiences)
     VALUES ('Item', $1, $2, $3, ARRAY['participant','sponsor']) RETURNING id`,
    [startsAt, new Date(startsAt.getTime() + HOUR), options.hidden ? "hidden" : "shown"],
  );
  const { rows } = await pool.query(
    `INSERT INTO activities (name, category, schedule_id) VALUES ('Item', $1, $2) RETURNING id`,
    [options.category ?? "meal", schedule[0].id],
  );
  if (options.kinds) {
    await pool.query(
      `INSERT INTO activity_rsvp_settings
         (activity_id, event_key, enabled, kinds, closes_at)
       SELECT $1, event_key, $2, $3::text[], $4 FROM event_config WHERE id = 1`,
      [
        rows[0].id,
        options.enabled ?? true,
        options.kinds,
        options.closesInHours === undefined
          ? null
          : new Date(Date.now() + options.closesInHours * HOUR),
      ],
    );
  }
  return rows[0].id;
}

type Answer = { activityId: number; answer: "yes" | "no" | "unsure" };

async function getItems(userId: number) {
  const res = await app.inject({ method: "GET", url: "/api/me/rsvps", headers: asUser(userId) });
  expect(res.statusCode).toBe(200);
  return res.json().items as Array<Record<string, unknown> & { activityId: number }>;
}

function putAnswers(userId: number, answers: Answer[], key?: string) {
  return app.inject({
    method: "PUT",
    url: "/api/me/rsvps",
    headers: { ...asUser(userId), ...(key ? { "idempotency-key": key } : {}) },
    payload: { answers },
  });
}

async function stored(userId: number) {
  const { rows } = await (await db()).query(
    `SELECT activity_id, event_key, attending FROM activity_rsvps
      WHERE user_id = $1 ORDER BY activity_id, event_key`,
    [userId],
  );
  return rows;
}

describe("eligibility", () => {
  it("never offers meals to registered participants, whatever the settings say", async () => {
    const participant = await person("participant");
    const sponsorParticipant = await person("participant", { alsoSponsor: true });
    const mentor = await person("mentor");
    const staff = await person("staff");
    const sponsor = await person("sponsor");
    const lunch = await activity({ kinds: ["sponsor", "mentor", "staff"] });
    // Even a hand-edited settings row that asks participants is ignored.
    const forced = await activity({ kinds: ["participant", "sponsor"] });

    expect((await getItems(participant)).map((i) => i.activityId)).toEqual([]);
    expect((await getItems(sponsorParticipant)).map((i) => i.activityId)).toEqual([]);
    for (const asked of [mentor, staff]) {
      expect((await getItems(asked)).map((i) => i.activityId)).toEqual([lunch]);
    }
    expect((await getItems(sponsor)).map((i) => i.activityId)).toEqual([lunch, forced]);

    for (const excluded of [participant, sponsorParticipant]) {
      const res = await putAnswers(excluded, [{ activityId: forced, answer: "yes" }]);
      expect(res.statusCode).toBe(403);
      expect(res.json().error.details.code).toBe("rsvp_participants_excluded");
      expect(await stored(excluded)).toEqual([]);
    }
  });

  it("offers nothing to an account with no attendance classification", async () => {
    const nobody = await person(null);
    const lunch = await activity({ kinds: ["sponsor", "staff", "mentor", "participant"] });
    expect(await getItems(nobody)).toEqual([]);
    const res = await putAnswers(nobody, [{ activityId: lunch, answer: "yes" }]);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.details.code).toBe("rsvp_not_offered");
  });

  it("offers a non-meal activity to the kinds it asks, participants included", async () => {
    const participant = await person("participant");
    const mentor = await person("mentor");
    const workshop = await activity({ category: "activity", kinds: ["participant"] });
    expect((await getItems(participant)).map((i) => i.activityId)).toEqual([workshop]);
    expect(await getItems(mentor)).toEqual([]);
    expect(
      (await putAnswers(participant, [{ activityId: workshop, answer: "yes" }])).statusCode,
    ).toBe(200);
    const refused = await putAnswers(mentor, [{ activityId: workshop, answer: "yes" }]);
    expect(refused.statusCode).toBe(400);
  });

  it("skips disabled and hidden activities but keeps ended ones", async () => {
    const sponsor = await person("sponsor");
    await activity({ kinds: ["sponsor"], enabled: false });
    await activity({ kinds: ["sponsor"], hidden: true });
    const ended = await activity({ kinds: ["sponsor"], startsInHours: -5 });
    const open = await activity({ kinds: ["sponsor"] });
    expect((await getItems(sponsor)).map((i) => i.activityId).sort()).toEqual([ended, open].sort());
  });

  it("keeps the meal-plan facade closed to participants and unclassified accounts", async () => {
    await activity({ kinds: ["sponsor"] });
    for (const kind of ["participant", null] as const) {
      const res = await app.inject({
        method: "GET",
        url: "/api/me/meal-plan",
        headers: asUser(await person(kind)),
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.details.code).toBe("meal_plan_not_eligible");
    }
  });
});

describe("answers", () => {
  it("stores unsure as an explicit answer distinct from no and from unanswered", async () => {
    const sponsor = await person("sponsor");
    const a = await activity({ kinds: ["sponsor"] });
    const b = await activity({ kinds: ["sponsor"] });
    const c = await activity({ kinds: ["sponsor"] });
    const res = await putAnswers(sponsor, [
      { activityId: a, answer: "unsure" },
      { activityId: b, answer: "no" },
    ]);
    expect(res.statusCode).toBe(200);
    const byId = Object.fromEntries(
      res
        .json()
        .items.map((i: { activityId: number; answer: string | null }) => [i.activityId, i.answer]),
    );
    expect(byId).toEqual({ [a]: "unsure", [b]: "no", [c]: null });
    expect((await stored(sponsor)).map((r) => [r.activity_id, r.attending])).toEqual([
      [a, null],
      [b, false],
    ]);
  });

  it("accepts unsure and lets every open item stay unanswered", async () => {
    const sponsor = await person("sponsor");
    const lunch = await activity({ kinds: ["sponsor"] });
    const dinner = await activity({ kinds: ["sponsor"] });

    expect((await putAnswers(sponsor, [{ activityId: lunch, answer: "unsure" }])).statusCode).toBe(
      200,
    );
    expect((await stored(sponsor)).map((r) => [r.activity_id, r.attending])).toEqual([
      [lunch, null],
    ]);

    expect((await putAnswers(sponsor, [{ activityId: dinner, answer: "yes" }])).statusCode).toBe(
      200,
    );
    expect((await stored(sponsor)).map((r) => r.activity_id)).toEqual([lunch, dinner]);
  });

  it("rejects the removed option field on an answer", async () => {
    const sponsor = await person("sponsor");
    const meal = await activity({ kinds: ["sponsor"] });
    const res = await putAnswers(sponsor, [
      { activityId: meal, answer: "yes", optionKey: "veg" } as Answer,
    ]);
    expect(res.statusCode).toBe(400);
    expect(await stored(sponsor)).toEqual([]);
  });

  it("locks changes after the close, but echoing an answer unchanged is accepted", async () => {
    const sponsor = await person("sponsor");
    const open = await activity({ kinds: ["sponsor"] });
    const closing = await activity({ kinds: ["sponsor"], closesInHours: 2 });
    expect((await putAnswers(sponsor, [{ activityId: closing, answer: "yes" }])).statusCode).toBe(
      200,
    );
    await (await db()).query(
      `UPDATE activity_rsvp_settings SET closes_at = now() - interval '1 minute' WHERE activity_id = $1`,
      [closing],
    );
    const items = await getItems(sponsor);
    expect(items.find((i) => i.activityId === closing)?.locked).toBe(true);

    const echo = await putAnswers(sponsor, [
      { activityId: open, answer: "yes" },
      { activityId: closing, answer: "yes" },
    ]);
    expect(echo.statusCode).toBe(200);
    const changed = await putAnswers(sponsor, [{ activityId: closing, answer: "no" }]);
    expect(changed.statusCode).toBe(409);
    expect(changed.json().error.details.code).toBe("rsvp_locked");
    expect((await stored(sponsor)).find((r) => r.activity_id === closing)?.attending).toBe(true);
  });

  it("serializes concurrent submissions into one whole stored payload", async () => {
    const sponsor = await person("sponsor");
    const a = await activity({ kinds: ["sponsor"] });
    const b = await activity({ kinds: ["sponsor"] });
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        putAnswers(sponsor, [
          { activityId: a, answer: i % 2 ? "yes" : "no" },
          { activityId: b, answer: i % 2 ? "yes" : "no" },
        ]),
      ),
    );
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
    const rows = await stored(sponsor);
    expect(rows).toHaveLength(2);
    expect(rows[0].attending).toBe(rows[1].attending);
  });

  it("replays an Idempotency-Key without a second broadcast", async () => {
    const sponsor = await person("sponsor");
    const a = await activity({ kinds: ["sponsor"] });
    const key = crypto.randomUUID();
    const first = await putAnswers(sponsor, [{ activityId: a, answer: "yes" }], key);
    const replay = await putAnswers(sponsor, [{ activityId: a, answer: "yes" }], key);
    expect(replay.json()).toEqual(first.json());
    const mismatch = await putAnswers(sponsor, [{ activityId: a, answer: "no" }], key);
    expect(mismatch.statusCode).toBe(409);
  });

  it("lets staff correct a user partially and audits attending ids only", async () => {
    const target = await person("sponsor");
    const manager = await createUserWithCapabilities([CAPABILITIES.MEAL_PLANS_MANAGE]);
    const meal = await activity({ kinds: ["sponsor"] });
    const res = await app.inject({
      method: "PUT",
      url: `/api/users/${target}/rsvps`,
      headers: asUser(manager),
      payload: { answers: [{ activityId: meal, answer: "yes" }] },
    });
    expect(res.statusCode).toBe(200);
    const { rows } = await (await db()).query(
      `SELECT actor_id, action, after FROM audit_log WHERE entity_type = 'user' AND entity_id = $1`,
      [String(target)],
    );
    expect(rows).toEqual([
      expect.objectContaining({
        actor_id: manager,
        action: "rsvp.updated",
        after: { attending: [meal] },
      }),
    ]);
    const forbidden = await app.inject({
      method: "PUT",
      url: `/api/users/${target}/rsvps`,
      headers: asUser(await createUserWithCapabilities([CAPABILITIES.LOGISTICS_STATS])),
      payload: { answers: [] },
    });
    expect(forbidden.statusCode).toBe(403);
  });
});

describe("removed option concept", () => {
  it("no longer exposes options on items or summaries and rejects them in settings", async () => {
    const organizer = await createUserWithCapabilities([
      CAPABILITIES.SCHEDULE_MANAGE,
      CAPABILITIES.LOGISTICS_STATS,
    ]);
    const sponsor = await person("sponsor");
    const meal = await activity({ kinds: ["sponsor"] });
    await putAnswers(sponsor, [{ activityId: meal, answer: "yes" }]);
    const { rows } = await (await db()).query(`SELECT schedule_id FROM activities WHERE id = $1`, [
      meal,
    ]);

    const put = await app.inject({
      method: "PUT",
      url: `/api/schedule/${rows[0].schedule_id}/rsvp`,
      headers: asUser(organizer),
      payload: {
        enabled: true,
        kinds: ["sponsor"],
        nameI18n: null,
        descriptionI18n: null,
        rsvpDate: null,
        closesAt: null,
        options: [{ key: "std", labelI18n: { en: "Standard" } }],
      },
    });
    expect(put.statusCode).toBe(400);

    const [item] = await getItems(sponsor);
    expect(item).not.toHaveProperty("options");
    expect(item).not.toHaveProperty("optionKey");

    const counts = await app.inject({
      method: "GET",
      url: "/api/logistics/rsvps",
      headers: asUser(organizer),
    });
    expect(counts.json().activities[0]).not.toHaveProperty("byOption");
  });
});

describe("attendance asked at creation", () => {
  it("creates the RSVP settings with the schedule item and exposes it in the overview", async () => {
    const organizer = await createUserWithCapabilities([
      CAPABILITIES.SCHEDULE_MANAGE,
      CAPABILITIES.LOGISTICS_STATS,
    ]);
    const startsAt = new Date(Date.now() + 48 * HOUR);
    const created = await app.inject({
      method: "POST",
      url: "/api/schedule",
      headers: asUser(organizer),
      payload: {
        title: "Workshop",
        startsAt: startsAt.toISOString(),
        endsAt: new Date(startsAt.getTime() + HOUR).toISOString(),
        visibility: "shown",
        audiences: ["participant"],
        rsvp: { enabled: true, kinds: ["participant"] },
      },
    });
    expect(created.statusCode).toBe(201);
    const { rows } = await (await db()).query(
      `SELECT st.activity_id, st.enabled, st.kinds
         FROM activity_rsvp_settings st
         JOIN activities a ON a.id = st.activity_id
        WHERE a.schedule_id = $1`,
      [created.json().id],
    );
    expect(rows).toEqual([
      { activity_id: expect.any(Number), enabled: true, kinds: ["participant"] },
    ]);

    const overview = await app.inject({
      method: "GET",
      url: "/api/logistics/rsvps",
      headers: asUser(organizer),
    });
    expect(overview.json().activities).toEqual([
      expect.objectContaining({ activityId: rows[0].activity_id, scheduleId: created.json().id }),
    ]);
  });

  it("rejects an enabled RSVP without an audience or with participants on a meal", async () => {
    const organizer = await createUserWithCapabilities([CAPABILITIES.SCHEDULE_MANAGE]);
    const startsAt = new Date(Date.now() + 48 * HOUR);
    const body = {
      title: "Workshop",
      startsAt: startsAt.toISOString(),
      endsAt: new Date(startsAt.getTime() + HOUR).toISOString(),
      visibility: "shown",
      audiences: ["participant"],
      rsvp: { enabled: true, kinds: [] },
    };
    const empty = await app.inject({
      method: "POST",
      url: "/api/schedule",
      headers: asUser(organizer),
      payload: body,
    });
    expect(empty.statusCode).toBe(400);
    expect(empty.json().error.details.code).toBe("rsvp_kinds_required");

    const meal = await app.inject({
      method: "POST",
      url: "/api/schedule",
      headers: asUser(organizer),
      payload: {
        ...body,
        type: "meal",
        rsvp: { enabled: true, kinds: ["participant"] },
      },
    });
    expect(meal.statusCode).toBe(400);
    expect(meal.json().error.details.code).toBe("rsvp_participants_excluded");
  });
});

describe("event editions", () => {
  it("keeps earlier editions as history and starts the new one unanswered", async () => {
    const pool = await db();
    const sponsor = await person("sponsor");
    const meal = await activity({ kinds: ["sponsor"] });
    await putAnswers(sponsor, [{ activityId: meal, answer: "yes" }]);

    await pool.query(
      `INSERT INTO editions (event_key, name, status) VALUES ('next-edition', 'Next', 'active')
       ON CONFLICT DO NOTHING`,
    );
    await pool.query(`UPDATE event_config SET event_key = 'next-edition' WHERE id = 1`);
    // Activities and their settings belong to their edition (multi-edition):
    // the new edition starts with nothing offered, and the old answer stays as history.
    expect(await getItems(sponsor)).toEqual([]);
    expect(await stored(sponsor)).toEqual([
      { activity_id: meal, event_key: "default", attending: true },
    ]);
  });
});

describe("organizer settings", () => {
  function payload(overrides: Record<string, unknown> = {}) {
    return {
      enabled: true,
      kinds: ["sponsor"],
      nameI18n: { es: "Comida", en: "Lunch" },
      descriptionI18n: null,
      rsvpDate: null,
      closesAt: null,
      ...overrides,
    };
  }

  it("validates, audits, replays idempotently and honours names and dates", async () => {
    const organizer = await createUserWithCapabilities([CAPABILITIES.SCHEDULE_MANAGE]);
    const meal = await activity({});
    const workshop = await activity({ category: "activity" });
    const pool = await db();
    const scheduleOf = async (id: number) =>
      (await pool.query(`SELECT schedule_id FROM activities WHERE id = $1`, [id])).rows[0]
        .schedule_id;
    const url = `/api/schedule/${await scheduleOf(meal)}/rsvp`;
    const send = (body: unknown, userId = organizer, key?: string) =>
      app.inject({
        method: "PUT",
        url,
        headers: { ...asUser(userId), ...(key ? { "idempotency-key": key } : {}) },
        payload: body as object,
      });

    expect(
      (await send(payload(), await createUserWithCapabilities([CAPABILITIES.SCHEDULE_READ])))
        .statusCode,
    ).toBe(403);
    const food = await send(payload({ kinds: ["participant", "sponsor"] }));
    expect(food.statusCode).toBe(400);
    expect(food.json().error.details.code).toBe("rsvp_participants_excluded");
    expect((await send(payload({ kinds: [] }))).statusCode).toBe(400);

    const date = new Date(Date.now() + 100 * HOUR).toISOString();
    const key = crypto.randomUUID();
    const ok = await send(payload({ rsvpDate: date }), organizer, key);
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({
      activityId: meal,
      isMeal: true,
      enabled: true,
      rsvpDate: date,
      counts: { eligible: 0 },
    });
    expect(ok.json()).not.toHaveProperty("required");
    expect((await send(payload({ rsvpDate: date }), organizer, key)).statusCode).toBe(200);
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM audit_log WHERE action = 'rsvp_settings.updated'`,
    );
    expect(rows[0].n).toBe(1);

    // Names and date overrides reach the attendee; a non-meal activity may ask participants.
    const sponsor = await person("sponsor");
    const [item] = await getItems(sponsor);
    expect(item).toMatchObject({ name: "Lunch", date });
    const wsUrl = `/api/schedule/${await scheduleOf(workshop)}/rsvp`;
    const ws = await app.inject({
      method: "PUT",
      url: wsUrl,
      headers: asUser(organizer),
      payload: payload({ kinds: ["participant"] }),
    });
    expect(ws.statusCode).toBe(200);
  });

  it("is scoped to the current edition", async () => {
    const organizer = await createUserWithCapabilities([CAPABILITIES.SCHEDULE_MANAGE]);
    const meal = await activity({ kinds: ["sponsor"] });
    const pool = await db();
    const { rows } = await pool.query(`SELECT schedule_id FROM activities WHERE id = $1`, [meal]);
    await pool.query(
      `INSERT INTO editions (event_key, name, status) VALUES ('next-edition', 'Next', 'active')
       ON CONFLICT DO NOTHING`,
    );
    await pool.query(
      `INSERT INTO user_roles (user_id, role_id, event_key)
       SELECT user_id, role_id, 'next-edition' FROM user_roles WHERE user_id = $1`,
      [organizer],
    );
    await pool.query(`UPDATE event_config SET event_key = 'next-edition' WHERE id = 1`);
    const res = await app.inject({
      method: "GET",
      url: `/api/schedule/${rows[0].schedule_id}/rsvp`,
      headers: asUser(organizer),
    });
    expect(res.json()).toMatchObject({ enabled: false, kinds: [] });
  });
});

describe("role audiences ask the people holding them (H59)", () => {
  it("asks anyone with at least one of the item's roles, besides the configured kinds", async () => {
    const speaker = await createRole([], { name: "Speaker", eventAccess: true });
    const holder = await person("mentor");
    await assignRole(holder, speaker);
    const outsider = await person("mentor");
    const pool = await db();
    const id = await activity({ category: "workshop", kinds: ["sponsor"] });
    await pool.query(
      `UPDATE schedule SET audiences = ARRAY['role:${speaker}'] WHERE id = (SELECT schedule_id FROM activities WHERE id = $1)`,
      [id],
    );
    expect((await getItems(holder)).map((item) => item.activityId)).toEqual([id]);
    expect(await getItems(outsider)).toEqual([]);
    const onboarding = await app.inject({
      method: "GET",
      url: "/api/me/onboarding",
      headers: asUser(holder),
    });
    expect(onboarding.statusCode).toBe(200);
    expect(onboarding.json().steps).toContainEqual(
      expect.objectContaining({ step: "rsvp", status: "pending" }),
    );
    const profile = await app.inject({ method: "GET", url: "/api/me", headers: asUser(holder) });
    expect(profile.json().pendingRsvps).toBe(true);
    expect(profile.json().pendingProfileTasks).not.toContain("rsvp");
    const outsiderOnboarding = await app.inject({
      method: "GET",
      url: "/api/me/onboarding",
      headers: asUser(outsider),
    });
    expect(
      outsiderOnboarding.json().steps.some((step: { step: string }) => step.step === "rsvp"),
    ).toBe(false);
    const answer = await app.inject({
      method: "PUT",
      url: "/api/me/rsvps",
      headers: { ...asUser(holder), "idempotency-key": crypto.randomUUID() },
      payload: { answers: [{ activityId: id, answer: "unsure" }] },
    });
    expect(answer.statusCode).toBe(200);
    const answered = await app.inject({ method: "GET", url: "/api/me", headers: asUser(holder) });
    expect(answered.json().pendingRsvps).toBe(false);
  });
});

describe("RSVPs asked of roles (H59)", () => {
  it("asks, and counts, whoever holds one of the chosen public roles", async () => {
    const speaker = await createRole([], { name: "Speaker", eventAccess: true });
    const holder = await person("mentor");
    await assignRole(holder, speaker);
    const outsider = await person("mentor");
    const organizer = await createUserWithCapabilities([CAPABILITIES.SCHEDULE_MANAGE]);
    const pool = await db();
    const id = await activity({ category: "workshop" });
    const { rows } = await pool.query(`SELECT schedule_id FROM activities WHERE id = $1`, [id]);

    const saved = await app.inject({
      method: "PUT",
      url: `/api/schedule/${rows[0].schedule_id}/rsvp`,
      headers: { ...asUser(organizer), "idempotency-key": crypto.randomUUID() },
      payload: {
        enabled: true,
        kinds: [],
        roleIds: [speaker],
        nameI18n: null,
        descriptionI18n: null,
        rsvpDate: null,
        closesAt: null,
      },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().roleIds).toEqual([speaker]);
    expect((await getItems(holder)).map((item) => item.activityId)).toEqual([id]);
    expect(await getItems(outsider)).toEqual([]);
    const again = await app.inject({
      method: "GET",
      url: `/api/schedule/${rows[0].schedule_id}/rsvp`,
      headers: asUser(organizer),
    });
    expect(again.json().counts.eligible).toBe(1);
  });

  it("needs an audience and refuses roles that are not publicly visible", async () => {
    const hidden = await createRole([], { isVisible: false });
    const organizer = await createUserWithCapabilities([CAPABILITIES.SCHEDULE_MANAGE]);
    const pool = await db();
    const id = await activity({ category: "workshop" });
    const { rows } = await pool.query(`SELECT schedule_id FROM activities WHERE id = $1`, [id]);
    const put = (roleIds: number[]) =>
      app.inject({
        method: "PUT",
        url: `/api/schedule/${rows[0].schedule_id}/rsvp`,
        headers: { ...asUser(organizer), "idempotency-key": crypto.randomUUID() },
        payload: {
          enabled: true,
          kinds: [],
          roleIds,
          nameI18n: null,
          descriptionI18n: null,
          rsvpDate: null,
          closesAt: null,
        },
      });
    const none = await put([]);
    expect(none.statusCode).toBe(400);
    expect(none.json().error.details.code).toBe("rsvp_kinds_required");
    const refused = await put([hidden]);
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error.details.code).toBe("rsvp_role_invalid");
  });

  it("still never offers meals to participants, even through a role they hold", async () => {
    const participantRole = await createRole([], { name: "Attendees", eventAccess: true });
    const participant = await person("participant");
    await assignRole(participant, participantRole);
    const pool = await db();
    const id = await activity({ category: "meal" });
    await pool.query(
      `INSERT INTO activity_rsvp_settings (activity_id, event_key, enabled, kinds, role_ids)
       SELECT $1, event_key, true, '{}', $2::int[] FROM event_config WHERE id = 1`,
      [id, [participantRole]],
    );
    expect(await getItems(participant)).toEqual([]);
  });
});

describe("GET /api/logistics/dietary", () => {
  it("lists everyone with intolerances or notes, with counts, and audits the read", async () => {
    const exporter = await createUserWithCapabilities([CAPABILITIES.MEAL_PLANS_EXPORT]);
    const pool = await db();
    const { rows } = await pool.query(
      `INSERT INTO food_intolerances (label) VALUES ('{"es":"Gluten","en":"Gluten"}'::jsonb) RETURNING id`,
    );
    const gluten = rows[0].id as number;
    const celiac = await person("participant");
    const noteOnly = await person("sponsor");
    const clean = await person("mentor");
    const fixture = await person("staff");
    await pool.query(`UPDATE users SET is_test_account = true WHERE id = $1`, [fixture]);
    await pool.query(
      `UPDATE users SET food_intolerances = ARRAY[$2::int], food_intolerance_notes = 'sin trazas' WHERE id = $1`,
      [celiac, gluten],
    );
    await pool.query(`UPDATE users SET food_intolerance_notes = 'alergia al kiwi' WHERE id = $1`, [
      noteOnly,
    ]);
    await pool.query(
      `UPDATE users SET food_intolerances = ARRAY[$2::int], food_intolerance_notes = 'oculto' WHERE id = $1`,
      [fixture, gluten],
    );

    const res = await app.inject({
      method: "GET",
      url: "/api/logistics/dietary",
      headers: asUser(exporter),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ people: 4, withRestrictions: 1, withNotes: 2 });
    expect(body.byIntolerance).toEqual([
      { id: gluten, label: { es: "Gluten", en: "Gluten" }, n: 1 },
    ]);
    expect(body.entries.map((e: { userId: number }) => e.userId).sort()).toEqual(
      [celiac, noteOnly].sort(),
    );
    expect(JSON.stringify(body)).not.toContain("oculto");
    expect(body.entries.find((e: { userId: number }) => e.userId === clean)).toBeUndefined();

    const { rows: audited } = await pool.query(
      `SELECT entity_type, action FROM audit_log WHERE entity_type = 'dietary_overview'`,
    );
    expect(audited).toEqual([{ entity_type: "dietary_overview", action: "view" }]);
    expect(JSON.stringify(audited)).not.toContain("kiwi");

    const denied = await app.inject({
      method: "GET",
      url: "/api/logistics/dietary",
      headers: asUser(await createUserWithCapabilities([CAPABILITIES.LOGISTICS_STATS])),
    });
    expect(denied.statusCode).toBe(403);
  });
});

describe("GET /api/logistics/rsvps/:activityId/people", () => {
  it("lists every eligible person asked with their answer, and nobody else", async () => {
    const stats = await createUserWithCapabilities([CAPABILITIES.LOGISTICS_STATS]);
    const meal = await activity({ kinds: ["sponsor", "mentor"] });
    await activity({ kinds: [] });
    const yes = await person("sponsor");
    const silent = await person("mentor");
    await person("staff"); // not asked
    await person("participant"); // never asked about a meal
    await putAnswers(yes, [{ activityId: meal, answer: "yes" }]);

    const res = await app.inject({
      method: "GET",
      url: `/api/logistics/rsvps/${meal}/people`,
      headers: asUser(stats),
    });
    expect(res.statusCode).toBe(200);
    const people = res.json().people as { userId: number; state: string; kind: string }[];
    expect(people.map((p) => [p.userId, p.state, p.kind]).sort()).toEqual(
      [
        [yes, "yes", "sponsor"],
        [silent, "unanswered", "mentor"],
      ].sort(),
    );
    expect(JSON.stringify(res.json())).not.toMatch(/intolerance|notes/i);

    const summary = await app.inject({
      method: "GET",
      url: "/api/logistics/rsvps",
      headers: asUser(stats),
    });
    expect(summary.json().activities[0].scheduleId).toEqual(expect.any(Number));
  });

  it("needs logistics statistics access and an asked activity", async () => {
    const meal = await activity({ kinds: ["sponsor"] });
    const denied = await app.inject({
      method: "GET",
      url: `/api/logistics/rsvps/${meal}/people`,
      headers: asUser(await createUser()),
    });
    expect(denied.statusCode).toBe(403);
    const stats = await createUserWithCapabilities([CAPABILITIES.LOGISTICS_STATS]);
    const missing = await app.inject({
      method: "GET",
      url: "/api/logistics/rsvps/999999/people",
      headers: asUser(stats),
    });
    expect(missing.statusCode).toBe(404);
  });
});

describe("GET /api/logistics/rsvps", () => {
  it("counts only eligible, real people by kind and answer", async () => {
    const stats = await createUserWithCapabilities([CAPABILITIES.LOGISTICS_STATS]);
    const meal = await activity({ kinds: ["sponsor", "mentor"] });
    await activity({ kinds: [] });
    const yes = await person("sponsor");
    const no = await person("sponsor");
    const unsure = await person("mentor");
    await person("mentor"); // never answers
    const fixture = await person("sponsor");
    await (await db()).query(`UPDATE users SET is_test_account = true WHERE id = $1`, [fixture]);
    const staff = await person("staff"); // not asked

    await putAnswers(yes, [{ activityId: meal, answer: "yes" }]);
    await putAnswers(no, [{ activityId: meal, answer: "no" }]);
    await putAnswers(unsure, [{ activityId: meal, answer: "unsure" }]);
    await putAnswers(fixture, [{ activityId: meal, answer: "yes" }]);
    // Stale answers from people no longer eligible never count: a participant row and a staff row.
    const pool = await db();
    for (const userId of [await person("participant"), staff]) {
      await pool.query(
        `INSERT INTO activity_rsvps (user_id, activity_id, event_key, attending)
         VALUES ($1, $2, 'default', true)`,
        [userId, meal],
      );
    }
    // A sponsor who also registered as participant stops being eligible.
    const promoted = await person("sponsor");
    await putAnswers(promoted, [{ activityId: meal, answer: "yes" }]);
    await grantAttendeeRole(promoted, "participant");

    const res = await app.inject({
      method: "GET",
      url: "/api/logistics/rsvps",
      headers: asUser(stats),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().activities).toEqual([
      expect.objectContaining({
        activityId: meal,
        eligible: 4,
        attending: 1,
        notAttending: 1,
        unsure: 1,
        unanswered: 1,
        byKind: {
          sponsor: { attending: 1, notAttending: 1, unsure: 0, unanswered: 0 },
          mentor: { attending: 0, notAttending: 0, unsure: 1, unanswered: 1 },
        },
      }),
    ]);

    // The review-fixture operator sees only test accounts.
    const synthetic = await createUserWithCapabilities([CAPABILITIES.LOGISTICS_STATS]);
    await pool.query(`UPDATE users SET is_test_account = true WHERE id = $1`, [synthetic]);
    const fixtureView = await app.inject({
      method: "GET",
      url: "/api/logistics/rsvps",
      headers: asUser(synthetic),
    });
    expect(fixtureView.json().activities[0]).toMatchObject({ eligible: 1, attending: 1 });

    const denied = await app.inject({
      method: "GET",
      url: "/api/logistics/rsvps",
      headers: asUser(await createUser()),
    });
    expect(denied.statusCode).toBe(403);
  });
});
