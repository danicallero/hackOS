import { CAPABILITIES } from "@hackos/shared/capabilities";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { pool } from "../../src/db/pool.js";
import {
  asUser,
  createRole,
  createUser,
  createUserWithCapabilities,
  ensureApplicationFormVersion,
  useTestApp,
} from "../helpers.js";

/** H61-H67 help desk: helper profiles, topics, routing, claims and coverage. */

let app: App;
const getApp = useTestApp();
beforeEach(async () => {
  app = await getApp();
});

let keySeq = 0;
const key = () => `hd-${++keySeq}-${crypto.randomUUID()}`;

function call(
  method: "GET" | "POST" | "PUT" | "PATCH",
  url: string,
  as: number,
  payload?: unknown,
) {
  return app.inject({
    method,
    url,
    headers: { ...asUser(as), ...(method === "GET" ? {} : { "idempotency-key": key() }) },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
}

const helperCaps = [CAPABILITIES.HELPDESK_OFFER];
const participantCaps = [CAPABILITIES.HELPDESK_REQUEST];

async function topic(name: string, as: number): Promise<number> {
  const res = await call("POST", "/api/helpdesk/topics", as, { name });
  expect([200, 201]).toContain(res.statusCode);
  return res.json().topic.id;
}

async function enter(userId: number) {
  await pool.query(
    `INSERT INTO time_logs (user_id, kind, scanned_at) VALUES ($1, 'in', now() - interval '5 minutes')`,
    [userId],
  );
}

async function exit(userId: number) {
  await pool.query(
    `INSERT INTO time_logs (user_id, kind, scanned_at) VALUES ($1, 'out', now() - interval '1 minute')`,
    [userId],
  );
}

const hour = 3_600_000;
const aroundNow = () => ({
  startsAt: new Date(Date.now() - hour).toISOString(),
  endsAt: new Date(Date.now() + hour).toISOString(),
});

/** A published helper with topics; `available` adds a current interval and presence. */
async function helper(topicIds: number[], opts: { scheduled?: boolean; present?: boolean } = {}) {
  const id = await createUserWithCapabilities(helperCaps);
  const res = await call("PUT", "/api/me/helper-profile", id, {
    published: true,
    topicIds,
    bio: "I help",
  });
  expect(res.statusCode).toBe(200);
  if (opts.scheduled ?? true) {
    const a = await call("PUT", "/api/me/helper-profile/availability", id, {
      intervals: [aroundNow()],
    });
    expect(a.statusCode).toBe(200);
  }
  if (opts.present ?? true) await enter(id);
  return id;
}

async function outbox(userId: number) {
  const { rows } = await pool.query(
    `SELECT payload FROM notification_outbox WHERE user_id = $1 AND category = 'helpdesk'
      AND channel = 'in_app' ORDER BY id`,
    [userId],
  );
  return rows.map((r) => r.payload as { kind: string; requestId: number; subject?: string });
}

async function team(members: number[]) {
  const { rows } = await pool.query(`INSERT INTO repos (name) VALUES ($1) RETURNING id`, [
    `Team ${crypto.randomUUID().slice(0, 6)}`,
  ]);
  for (const userId of members) {
    await pool.query(
      `INSERT INTO submissions (repo_id, user_id, status) VALUES ($1, $2, 'active')`,
      [rows[0].id, userId],
    );
  }
  return rows[0].id as number;
}

describe("H61 knowledge catalogue", () => {
  it("dedupes equivalent names, reserves Other and searches without accents", async () => {
    const p = await createUserWithCapabilities(participantCaps);
    const first = await call("POST", "/api/helpdesk/topics", p, { name: "Diseño  UX" });
    expect(first.statusCode).toBe(201);
    const again = await call("POST", "/api/helpdesk/topics", p, { name: " diseno ux " });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ created: false, topic: { id: first.json().topic.id } });
    const other = await call("POST", "/api/helpdesk/topics", p, { name: "Otros" });
    expect(other.statusCode).toBe(400);
    expect(other.json().error.details.code).toBe("topic_reserved");
    await topic("Vitest", p);
    await topic("Vite", p);
    const search = await call("GET", "/api/helpdesk/topics?q=vite", p);
    expect(search.json().topics.map((t: { name: string }) => t.name)).toEqual(["Vite", "Vitest"]);
    const accent = await call("GET", "/api/helpdesk/topics?q=diseño", p);
    expect(accent.json().topics).toHaveLength(1);
  });

  it("rejects catalogue access without a help desk role", async () => {
    const nobody = await createUser();
    expect((await call("GET", "/api/helpdesk/topics", nobody)).statusCode).toBe(403);
  });

  it("merges duplicates into the target for profiles, gated by helpdesk:manage", async () => {
    const manager = await createUserWithCapabilities([
      CAPABILITIES.HELPDESK_MANAGE,
      CAPABILITIES.HELPDESK_REQUEST,
    ]);
    const a = await topic("React", manager);
    const b = await topic("ReactJS", manager);
    const h = await helper([b]);
    expect(
      (await call("POST", `/api/helpdesk/topics/${b}/merge`, h, { targetId: a })).statusCode,
    ).toBe(403);
    const merged = await call("POST", `/api/helpdesk/topics/${b}/merge`, manager, { targetId: a });
    expect(merged.statusCode).toBe(200);
    const card = await call("GET", `/api/helpdesk/helpers/${h}`, manager);
    expect(card.json().topics).toEqual([{ id: a, name: "React" }]);
    const rename = await call("PATCH", `/api/helpdesk/topics/${a}`, manager, { name: "react" });
    expect(rename.json()).toEqual({ id: a, name: "react" });
  });
});

describe("H61 helper profile", () => {
  it("shares the public-profile bio, stays separate from sharing consent and shows knowledge on the public card", async () => {
    const h = await createUserWithCapabilities(helperCaps);
    const t = await topic("Angular", h);
    const incomplete = await call("PUT", "/api/me/helper-profile", h, {
      published: true,
      topicIds: [],
    });
    expect(incomplete.statusCode).toBe(409);
    expect(incomplete.json().error.details.code).toBe("helper_profile_incomplete");
    const res = await call("PUT", "/api/me/helper-profile", h, {
      published: true,
      topicIds: [t],
      bio: "Frontend\nlead",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ eligible: true, published: true, bio: "Frontend\nlead" });
    const pub = await call("GET", "/api/me/public-profile", h);
    expect(pub.json()).toMatchObject({ directoryVisible: false, bio: "Frontend\nlead" });
    expect(pub.json().preview.helpTopics).toEqual([{ id: t, name: "Angular" }]);
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM audit_log WHERE entity_type = 'helper_profile' AND actor_id = $1`,
      [h],
    );
    expect(rows[0].n).toBe(1);
  });

  it("lets accepted mentors prepare before confirmation and refuses everyone else", async () => {
    const mentorRole = await createRole([CAPABILITIES.HELPDESK_OFFER], { name: "Mentor" });
    const { rows: app1 } = await pool.query(
      `INSERT INTO applications (name, template) VALUES ('Mentors', '{}'::jsonb) RETURNING id`,
    );
    await pool.query(
      `INSERT INTO application_grants_roles (application_id, role_id) VALUES ($1, $2)`,
      [app1[0].id, mentorRole],
    );
    const version = await ensureApplicationFormVersion(app1[0].id);
    const mentor = await createUser();
    await pool.query(
      `INSERT INTO application_responses (user_id, application_id, application_form_version_id, status)
       VALUES ($1, $2, $3, 'accepted')`,
      [mentor, app1[0].id, version],
    );
    const own = await call("GET", "/api/me/helper-profile", mentor);
    expect(own.json()).toMatchObject({ eligible: true, published: false });
    expect(own.json().preview.kind).toBe("mentor");
    const t = await topic("Rust", mentor);
    const put = await call("PUT", "/api/me/helper-profile", mentor, {
      published: true,
      topicIds: [t],
    });
    expect(put.statusCode).toBe(200);

    const stranger = await createUser();
    expect((await call("GET", "/api/me/helper-profile", stranger)).json().eligible).toBe(false);
    const denied = await call("PUT", "/api/me/helper-profile", stranger, {
      published: false,
      topicIds: [],
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.details.code).toBe("helper_not_eligible");
  });

  it("rejects overlapping or over-long availability (H62)", async () => {
    const h = await createUserWithCapabilities(helperCaps);
    const base = Date.now();
    const overlap = await call("PUT", "/api/me/helper-profile/availability", h, {
      intervals: [
        { startsAt: new Date(base).toISOString(), endsAt: new Date(base + 2 * hour).toISOString() },
        {
          startsAt: new Date(base + hour).toISOString(),
          endsAt: new Date(base + 3 * hour).toISOString(),
        },
      ],
    });
    expect(overlap.statusCode).toBe(400);
    expect(overlap.json().error.details.code).toBe("availability_overlap");
    const long = await call("PUT", "/api/me/helper-profile/availability", h, {
      intervals: [
        {
          startsAt: new Date(base).toISOString(),
          endsAt: new Date(base + 25 * hour).toISOString(),
        },
      ],
    });
    expect(long.json().error.details.code).toBe("availability_invalid");
    const days = await call("PUT", "/api/me/helper-profile/availability", h, {
      intervals: [
        {
          startsAt: new Date(base + 24 * hour).toISOString(),
          endsAt: new Date(base + 26 * hour).toISOString(),
        },
        { startsAt: new Date(base).toISOString(), endsAt: new Date(base + 2 * hour).toISOString() },
      ],
    });
    expect(days.statusCode).toBe(200);
    expect(days.json().availability[0].startsAt).toBe(new Date(base).toISOString());
  });
});

describe("H63 browse helpers", () => {
  it("lists only published helpers and separates schedule from presence", async () => {
    const p = await createUserWithCapabilities(participantCaps);
    const t = await topic("Python", p);
    const here = await helper([t]);
    const scheduledAway = await helper([t], { present: false });
    const hidden = await createUserWithCapabilities(helperCaps);
    await call("PUT", "/api/me/helper-profile", hidden, { published: false, topicIds: [t] });
    const res = await call("GET", `/api/helpdesk/helpers?topicId=${t}`, p);
    expect(res.statusCode).toBe(200);
    const cards = res.json().helpers as {
      userId: number;
      scheduledNow: boolean;
      present: boolean;
      availableNow: boolean;
    }[];
    expect(cards.map((c) => c.userId)).toEqual([here, scheduledAway]);
    expect(cards[1]).toMatchObject({ scheduledNow: true, present: false, availableNow: false });
    const now = await call("GET", "/api/helpdesk/helpers?availableNow=true", p);
    expect(now.json().helpers.map((c: { userId: number }) => c.userId)).toEqual([here]);
    expect((await call("GET", `/api/helpdesk/helpers/${hidden}`, p)).statusCode).toBe(404);
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM diary_entries`);
    expect(rows[0].n).toBe(0);
  });
});

describe("H64-H65 requests and routing", () => {
  it("notifies available, present helpers who match any topic", async () => {
    const p = await createUserWithCapabilities(participantCaps);
    const fe = await topic("Frontend", p);
    const be = await topic("Backend", p);
    const match = await helper([fe]);
    const other = await helper([be]);
    const away = await helper([fe], { present: false });
    const left = await helper([fe]);
    await exit(left);
    const unscheduled = await helper([fe], { scheduled: false });
    const res = await call("POST", "/api/helpdesk/requests", p, {
      description: "Vite build fails",
      location: "Table 12",
      topicIds: [fe],
      other: false,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ status: "open", routing: "matched", notifiedCount: 1 });
    expect(await outbox(match)).toHaveLength(1);
    for (const id of [other, away, left, unscheduled]) expect(await outbox(id)).toHaveLength(0);
    const [notice] = await outbox(match);
    expect(notice).toMatchObject({ kind: "request_created", requestId: res.json().id });
    expect(notice?.subject).toContain("Frontend");
  });

  it("falls back to every available helper for Other or when nobody matches", async () => {
    const p1 = await createUserWithCapabilities(participantCaps);
    const p2 = await createUserWithCapabilities(participantCaps);
    const fe = await topic("Frontend", p1);
    const ml = await topic("ML", p1);
    const a = await helper([fe]);
    const b = await helper([fe]);
    const viaOther = await call("POST", "/api/helpdesk/requests", p1, {
      description: "Pitch advice",
      location: "Hall",
      topicIds: [],
      other: true,
    });
    expect(viaOther.json()).toMatchObject({ routing: "fallback", notifiedCount: 2 });
    const noMatch = await call("POST", "/api/helpdesk/requests", p2, {
      description: "Model tuning",
      location: "Room 2",
      topicIds: [ml],
      other: false,
    });
    expect(noMatch.json()).toMatchObject({ routing: "fallback", notifiedCount: 2 });
    expect(await outbox(a)).toHaveLength(2);
    expect(await outbox(b)).toHaveLength(2);
  });

  it("stays open with routing none when nobody is available, and one active request per team", async () => {
    const p = await createUserWithCapabilities(participantCaps);
    const mate = await createUserWithCapabilities(participantCaps);
    const repo = await team([p, mate]);
    const t = await topic("Go", p);
    await helper([t], { present: false });
    const first = await call("POST", "/api/helpdesk/requests", p, {
      description: "Help",
      location: "Here",
      topicIds: [t],
      other: false,
      projectId: repo,
    });
    expect(first.json()).toMatchObject({
      routing: "none",
      notifiedCount: 0,
      project: { id: repo },
    });
    const dup = await call("POST", "/api/helpdesk/requests", mate, {
      description: "Again",
      location: "Here",
      topicIds: [],
      other: true,
      projectId: repo,
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.details.code).toBe("help_request_active");
    const mine = await call("GET", "/api/helpdesk/requests/mine", mate);
    expect(mine.json().requests.map((r: { id: number }) => r.id)).toEqual([first.json().id]);
    const outsider = await createUserWithCapabilities(participantCaps);
    expect(
      (await call("GET", `/api/helpdesk/requests/${first.json().id}`, outsider)).statusCode,
    ).toBe(404);
    const notMember = await call("POST", "/api/helpdesk/requests", outsider, {
      description: "x",
      location: "y",
      topicIds: [],
      other: true,
      projectId: repo,
    });
    expect(notMember.statusCode).toBe(403);
  });

  it("requires a topic or Other", async () => {
    const p = await createUserWithCapabilities(participantCaps);
    const res = await call("POST", "/api/helpdesk/requests", p, {
      description: "x",
      location: "y",
      topicIds: [],
      other: false,
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("H66 claiming", () => {
  async function openRequest() {
    const p = await createUserWithCapabilities(participantCaps);
    const mate = await createUserWithCapabilities(participantCaps);
    const repo = await team([p, mate]);
    const t = await topic(`T-${crypto.randomUUID().slice(0, 6)}`, p);
    const helpers = [await helper([t]), await helper([t]), await helper([t])];
    const res = await call("POST", "/api/helpdesk/requests", p, {
      description: "Stuck",
      location: "Table 4",
      topicIds: [t],
      other: false,
      projectId: repo,
    });
    return { p, mate, helpers, id: res.json().id as number };
  }

  it("lets exactly one of several simultaneous claims win", async () => {
    const { p, mate, helpers, id } = await openRequest();
    const results = await Promise.all(
      helpers.map((h) =>
        call("POST", `/api/helpdesk/requests/${id}/claim`, h, { mode: "on_my_way" }),
      ),
    );
    const winners = results.filter((r) => r.statusCode === 200);
    expect(winners).toHaveLength(1);
    for (const loser of results.filter((r) => r.statusCode !== 200)) {
      expect(loser.statusCode).toBe(409);
      expect(loser.json().error.details.code).toBe("help_request_already_claimed");
    }
    for (const member of [p, mate]) {
      const notices = (await outbox(member)).filter((n) => n.kind === "request_claimed");
      expect(notices).toHaveLength(1);
    }
    const view = await call("GET", `/api/helpdesk/requests/${id}`, mate);
    expect(view.json()).toMatchObject({ status: "claimed", claim: { mode: "on_my_way" } });
  });

  it("replays a retried claim without delivering twice and supports meet_at", async () => {
    const { p, helpers, id } = await openRequest();
    const h = helpers[0] as number;
    const headers = { ...asUser(h), "idempotency-key": "claim-retry" };
    const payload = { mode: "meet_at", meetingLocation: "Sponsor stand B" };
    const first = await app.inject({
      method: "POST",
      url: `/api/helpdesk/requests/${id}/claim`,
      headers,
      payload,
    });
    const retry = await app.inject({
      method: "POST",
      url: `/api/helpdesk/requests/${id}/claim`,
      headers,
      payload,
    });
    const fresh = await call("POST", `/api/helpdesk/requests/${id}/claim`, h, payload);
    expect([first.statusCode, retry.statusCode, fresh.statusCode]).toEqual([200, 200, 200]);
    expect(first.json().claim).toMatchObject({
      mode: "meet_at",
      meetingLocation: "Sponsor stand B",
    });
    const notices = (await outbox(p)).filter((n) => n.kind === "request_claimed");
    expect(notices).toHaveLength(1);
    expect(notices[0]?.subject).toContain("Sponsor stand B");
  });

  it("refuses claiming your own request", async () => {
    const both = await createUserWithCapabilities([...helperCaps, ...participantCaps]);
    const t = await topic("Docker", both);
    await call("PUT", "/api/me/helper-profile", both, { published: true, topicIds: [t] });
    const req = await call("POST", "/api/helpdesk/requests", both, {
      description: "x",
      location: "y",
      topicIds: [t],
      other: false,
    });
    const claim = await call("POST", `/api/helpdesk/requests/${req.json().id}/claim`, both, {
      mode: "on_my_way",
    });
    expect(claim.statusCode).toBe(409);
    expect(claim.json().error.details.code).toBe("help_request_not_claimable");
  });

  it("runs release, resolve and cancel transitions with explicit errors", async () => {
    const { p, mate, helpers, id } = await openRequest();
    const [h1, h2] = helpers as [number, number];
    expect(
      (await call("POST", `/api/helpdesk/requests/${id}/resolve`, p)).json().error.details.code,
    ).toBe("help_request_not_claimed");
    await call("POST", `/api/helpdesk/requests/${id}/claim`, h1, { mode: "on_my_way" });
    expect((await call("POST", `/api/helpdesk/requests/${id}/release`, h2)).statusCode).toBe(409);
    const released = await call("POST", `/api/helpdesk/requests/${id}/release`, h1);
    expect(released.json()).toMatchObject({ status: "open", claim: null });
    expect((await outbox(mate)).some((n) => n.kind === "request_released")).toBe(true);
    await call("POST", `/api/helpdesk/requests/${id}/claim`, h2, { mode: "on_my_way" });
    const resolved = await call("POST", `/api/helpdesk/requests/${id}/resolve`, mate);
    expect(resolved.json()).toMatchObject({ status: "resolved" });
    const cancel = await call("POST", `/api/helpdesk/requests/${id}/cancel`, p);
    expect(cancel.json().error.details.code).toBe("help_request_closed");
    const inbox = await call("GET", "/api/helpdesk/inbox?scope=mine", h2);
    expect(inbox.json().requests.map((r: { id: number }) => r.id)).toEqual([id]);
    const { rows } = await pool.query(
      `SELECT action FROM audit_log WHERE entity_type = 'help_request' AND entity_id = $1 ORDER BY id`,
      [String(id)],
    );
    expect(rows.map((r) => r.action)).toEqual([
      "created",
      "claimed",
      "released",
      "claimed",
      "resolved",
    ]);
  });

  it("tells the claimer when the requester cancels", async () => {
    const { p, helpers, id } = await openRequest();
    const h = helpers[0] as number;
    await call("POST", `/api/helpdesk/requests/${id}/claim`, h, { mode: "on_my_way" });
    const cancelled = await call("POST", `/api/helpdesk/requests/${id}/cancel`, p);
    expect(cancelled.json()).toMatchObject({ status: "cancelled" });
    expect((await outbox(h)).some((n) => n.kind === "request_cancelled")).toBe(true);
  });
});

describe("H67 coverage", () => {
  it("counts scheduled helpers per slot and separates presence now", async () => {
    const organizer = await createUserWithCapabilities([
      CAPABILITIES.HELPDESK_COVERAGE,
      CAPABILITIES.HELPDESK_REQUEST,
    ]);
    const fe = await topic("Frontend", organizer);
    const ml = await topic("ML", organizer);
    await helper([fe]);
    await helper([fe], { present: false });
    await helper([ml], { scheduled: false });
    const from = new Date(Math.floor(Date.now() / hour) * hour - 2 * hour).toISOString();
    const to = new Date(Math.floor(Date.now() / hour) * hour + 3 * hour).toISOString();
    const res = await call(
      "GET",
      `/api/helpdesk/coverage?from=${from}&to=${to}&stepMinutes=60`,
      organizer,
    );
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totals.publishedHelpers).toBe(3);
    expect(body.slots).toHaveLength(5);
    expect(Math.max(...body.slots.map((s: { scheduled: number }) => s.scheduled))).toBe(2);
    expect(body.now).toMatchObject({ scheduled: 2, present: 2, available: 1 });
    expect(body.now.topics).toEqual([{ id: fe, name: "Frontend", scheduled: 2, available: 1 }]);
    const participant = await createUserWithCapabilities(participantCaps);
    expect((await call("GET", "/api/helpdesk/coverage", participant)).statusCode).toBe(403);
  });
});
