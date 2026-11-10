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

/** Per-activity RSVPs: eligibility, answers, options, locks, history and counts. */

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
    required?: boolean;
    enabled?: boolean;
    options?: Array<{ key: string; label_i18n: Record<string, string>; retired?: boolean }>;
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
         (activity_id, event_key, enabled, required, kinds, options, closes_at)
       SELECT $1, event_key, $2, $3, $4::text[], $5::jsonb, $6 FROM event_config WHERE id = 1`,
      [
        rows[0].id,
        options.enabled ?? true,
        options.required ?? false,
        options.kinds,
        JSON.stringify(options.options ?? []),
        options.closesInHours === undefined
          ? null
          : new Date(Date.now() + options.closesInHours * HOUR),
      ],
    );
  }
  return rows[0].id;
}

type Answer = { activityId: number; answer: "yes" | "no" | "unsure"; optionKey?: string | null };

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
    `SELECT activity_id, event_key, attending, option_key FROM activity_rsvps
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

  it("skips disabled, hidden and ended activities", async () => {
    const sponsor = await person("sponsor");
    await activity({ kinds: ["sponsor"], enabled: false });
    await activity({ kinds: ["sponsor"], hidden: true });
    await activity({ kinds: ["sponsor"], startsInHours: -5 });
    const open = await activity({ kinds: ["sponsor"] });
    expect((await getItems(sponsor)).map((i) => i.activityId)).toEqual([open]);
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

  it("requires every required item, but lets optional ones be skipped", async () => {
    const sponsor = await person("sponsor");
    const required = await activity({ kinds: ["sponsor"], required: true });
    const optional = await activity({ kinds: ["sponsor"] });

    const missing = await putAnswers(sponsor, [{ activityId: optional, answer: "yes" }]);
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error.details).toMatchObject({
      code: "rsvp_incomplete",
      activityIds: [required],
    });
    expect(await stored(sponsor)).toEqual([]);

    const unsure = await putAnswers(sponsor, [{ activityId: required, answer: "unsure" }]);
    expect(unsure.statusCode).toBe(400);
    expect(unsure.json().error.details.code).toBe("rsvp_unsure_not_allowed");

    const ok = await putAnswers(sponsor, [{ activityId: required, answer: "no" }]);
    expect(ok.statusCode).toBe(200);
    expect((await stored(sponsor)).map((r) => r.activity_id)).toEqual([required]);

    // Once stored, a later optional-only submission needs no repeat of the required answer.
    expect(
      (await putAnswers(sponsor, [{ activityId: optional, answer: "unsure" }])).statusCode,
    ).toBe(200);
  });

  it("validates options, keeps the stored one when omitted and clears it on no", async () => {
    const sponsor = await person("sponsor");
    const meal = await activity({
      kinds: ["sponsor"],
      options: [
        { key: "veg", label_i18n: { es: "Vegetariano", en: "Vegetarian" } },
        { key: "std", label_i18n: { es: "Normal", en: "Standard" } },
      ],
    });
    const none = await putAnswers(sponsor, [{ activityId: meal, answer: "yes" }]);
    expect(none.statusCode).toBe(400);
    expect(none.json().error.details.code).toBe("rsvp_option_required");
    const bad = await putAnswers(sponsor, [{ activityId: meal, answer: "yes", optionKey: "nope" }]);
    expect(bad.statusCode).toBe(400);
    const takesNone = await putAnswers(sponsor, [
      { activityId: meal, answer: "no", optionKey: "veg" },
    ]);
    expect(takesNone.json().error.details.code).toBe("rsvp_option_invalid");

    expect(
      (await putAnswers(sponsor, [{ activityId: meal, answer: "yes", optionKey: "veg" }]))
        .statusCode,
    ).toBe(200);
    // Omitted keeps the stored option.
    expect((await putAnswers(sponsor, [{ activityId: meal, answer: "yes" }])).statusCode).toBe(200);
    expect((await stored(sponsor))[0].option_key).toBe("veg");
    expect((await putAnswers(sponsor, [{ activityId: meal, answer: "no" }])).statusCode).toBe(200);
    expect((await stored(sponsor))[0]).toMatchObject({ attending: false, option_key: null });
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
    const required = await activity({ kinds: ["sponsor"], required: true });
    const res = await app.inject({
      method: "PUT",
      url: `/api/users/${target}/rsvps`,
      headers: asUser(manager),
      payload: { answers: [{ activityId: required, answer: "yes" }] },
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
        after: { attending: [required] },
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

describe("options history", () => {
  it("retires removed options, keeps past answers, labels and counts", async () => {
    const organizer = await createUserWithCapabilities([
      CAPABILITIES.SCHEDULE_MANAGE,
      CAPABILITIES.LOGISTICS_STATS,
    ]);
    const sponsor = await person("sponsor");
    const meal = await activity({
      kinds: ["sponsor"],
      options: [
        { key: "veg", label_i18n: { en: "Vegetarian" } },
        { key: "std", label_i18n: { en: "Standard" } },
      ],
    });
    await putAnswers(sponsor, [{ activityId: meal, answer: "yes", optionKey: "veg" }]);
    const { rows } = await (await db()).query(`SELECT schedule_id FROM activities WHERE id = $1`, [
      meal,
    ]);
    const url = `/api/schedule/${rows[0].schedule_id}/rsvp`;

    const put = await app.inject({
      method: "PUT",
      url,
      headers: asUser(organizer),
      payload: {
        enabled: true,
        required: false,
        kinds: ["sponsor"],
        nameI18n: null,
        descriptionI18n: null,
        rsvpDate: null,
        closesAt: null,
        options: [{ key: "std", labelI18n: { en: "Standard" } }],
      },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().options).toEqual([
      { key: "std", labelI18n: { en: "Standard" }, retired: false },
      { key: "veg", labelI18n: { en: "Vegetarian" }, retired: true },
    ]);

    const [item] = await getItems(sponsor);
    expect(item).toMatchObject({
      answer: "yes",
      optionKey: "veg",
      optionLabel: "Vegetarian",
      optionRetired: true,
      options: [{ key: "std", label: "Standard" }],
    });
    // Echoing the retired answer unchanged is accepted; picking another works.
    expect(
      (await putAnswers(sponsor, [{ activityId: meal, answer: "yes", optionKey: "veg" }]))
        .statusCode,
    ).toBe(200);

    const counts = await app.inject({
      method: "GET",
      url: "/api/logistics/rsvps",
      headers: asUser(organizer),
    });
    expect(counts.json().activities[0].byOption).toEqual([
      { key: "std", labelI18n: { en: "Standard" }, retired: false, n: 0 },
      { key: "veg", labelI18n: { en: "Vegetarian" }, retired: true, n: 1 },
    ]);
  });
});

describe("event editions", () => {
  it("keeps earlier editions as history and starts the new one unanswered", async () => {
    const pool = await db();
    const sponsor = await person("sponsor");
    const meal = await activity({ kinds: ["sponsor"] });
    await putAnswers(sponsor, [{ activityId: meal, answer: "yes" }]);

    await pool.query(`UPDATE event_config SET event_key = 'next-edition' WHERE id = 1`);
    // No settings for the new key yet: nothing is offered, nothing is counted.
    expect(await getItems(sponsor)).toEqual([]);

    // Event access is edition-scoped: the sponsor needs this edition's role evidence too.
    await pool.query(
      `INSERT INTO user_role_event_evidence (user_id, role_id, event_key, assigned_at)
       SELECT user_id, role_id, 'next-edition', now() FROM user_role_event_evidence WHERE user_id = $1`,
      [sponsor],
    );
    await pool.query(
      `INSERT INTO activity_rsvp_settings (activity_id, event_key, enabled, kinds)
       VALUES ($1, 'next-edition', true, ARRAY['sponsor'])`,
      [meal],
    );
    expect((await getItems(sponsor))[0]).toMatchObject({ answer: null });
    expect((await putAnswers(sponsor, [{ activityId: meal, answer: "no" }])).statusCode).toBe(200);
    expect(await stored(sponsor)).toEqual([
      { activity_id: meal, event_key: "default", attending: true, option_key: null },
      { activity_id: meal, event_key: "next-edition", attending: false, option_key: null },
    ]);
  });
});

describe("organizer settings", () => {
  function payload(overrides: Record<string, unknown> = {}) {
    return {
      enabled: true,
      required: false,
      kinds: ["sponsor"],
      nameI18n: { es: "Comida", en: "Lunch" },
      descriptionI18n: null,
      rsvpDate: null,
      closesAt: null,
      options: [],
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
    expect((await send(payload({ enabled: false, required: true }))).statusCode).toBe(400);
    expect((await send(payload({ kinds: [] }))).statusCode).toBe(400);
    expect(
      (await send(payload({ options: [{ key: "A b", labelI18n: { en: "x" } }] }))).statusCode,
    ).toBe(400);
    expect(
      (
        await send(
          payload({
            options: [
              { key: "a", labelI18n: { en: "x" } },
              { key: "a", labelI18n: { en: "y" } },
            ],
          }),
        )
      ).statusCode,
    ).toBe(400);
    expect(
      (await send(payload({ options: [{ key: "a", labelI18n: { en: " " } }] }))).statusCode,
    ).toBe(400);

    const date = new Date(Date.now() + 100 * HOUR).toISOString();
    const key = crypto.randomUUID();
    const ok = await send(payload({ rsvpDate: date, required: true }), organizer, key);
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({
      activityId: meal,
      isMeal: true,
      enabled: true,
      required: true,
      rsvpDate: date,
      counts: { eligible: 0 },
    });
    expect(
      (await send(payload({ rsvpDate: date, required: true }), organizer, key)).statusCode,
    ).toBe(200);
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM audit_log WHERE action = 'rsvp_settings.updated'`,
    );
    expect(rows[0].n).toBe(1);

    // Names and date overrides reach the attendee; a non-meal activity may ask participants.
    const sponsor = await person("sponsor");
    const [item] = await getItems(sponsor);
    expect(item).toMatchObject({ name: "Lunch", date, required: true });
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
    await pool.query(`UPDATE event_config SET event_key = 'next-edition' WHERE id = 1`);
    const res = await app.inject({
      method: "GET",
      url: `/api/schedule/${rows[0].schedule_id}/rsvp`,
      headers: asUser(organizer),
    });
    expect(res.json()).toMatchObject({ enabled: false, kinds: [] });
  });
});

describe("GET /api/logistics/rsvps", () => {
  it("counts only eligible, real people by kind and answer", async () => {
    const stats = await createUserWithCapabilities([CAPABILITIES.LOGISTICS_STATS]);
    const meal = await activity({ kinds: ["sponsor", "mentor"] });
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
