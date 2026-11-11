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
import { admitParticipant } from "../projects/fixtures.js";

/** H61-H67 help desk: helper profiles, topics, routing, claims and coverage. */

let app: App;
const getApp = useTestApp();
beforeEach(async () => {
  app = await getApp();
});

let keySeq = 0;
const key = () => `hd-${++keySeq}-${crypto.randomUUID()}`;

function call(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
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

/** Only eligible helpers (or managers) add topics, so seed through a fresh helper. */
async function topic(name: string, _as?: number): Promise<number> {
  const seeder = await createUserWithCapabilities(helperCaps);
  const res = await call("POST", "/api/helpdesk/topics", seeder, { name });
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
    const p = await createUserWithCapabilities(helperCaps);
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

  it("only eligible helpers add topics; requesters can still search", async () => {
    const requester = await createUserWithCapabilities(participantCaps);
    const denied = await call("POST", "/api/helpdesk/topics", requester, { name: "Nope" });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.details.code).toBe("helper_not_eligible");
    expect((await call("GET", "/api/helpdesk/topics", requester)).statusCode).toBe(200);
    const helperUser = await createUserWithCapabilities(helperCaps);
    expect(
      (await call("POST", "/api/helpdesk/topics", helperUser, { name: "Yes" })).statusCode,
    ).toBe(201);
    const manager = await createUserWithCapabilities([CAPABILITIES.HELPDESK_MANAGE]);
    expect((await call("POST", "/api/helpdesk/topics", manager, { name: "Also" })).statusCode).toBe(
      403,
    );
  });

  it("shows requesters only the topics of helpers who are in the venue now", async () => {
    const asker = await createUserWithCapabilities(participantCaps);
    const here = await topic("InVenue");
    const away = await topic("Away");
    await helper([here]);
    await helper([away], { present: false });
    const names = async (as: number, query = "") =>
      (await call("GET", `/api/helpdesk/topics${query}`, as))
        .json()
        .topics.map((t: { name: string }) => t.name);
    expect(await names(asker)).toEqual(["InVenue"]);
    // A helper preparing a profile sees the whole catalogue, unless a request form asks.
    const preparing = await createUserWithCapabilities(helperCaps);
    expect(await names(preparing)).toEqual(expect.arrayContaining(["InVenue", "Away"]));
    expect(await names(preparing, "?available=1")).toEqual(["InVenue"]);
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
  it("leaves the bio to the public profile, stays separate from sharing consent and shows knowledge on the public card", async () => {
    const h = await createUserWithCapabilities(helperCaps);
    const t = await topic("Angular", h);
    // A helper can publish without naming any knowledge: a generalist (H61, H65).
    const generalist = await call("PUT", "/api/me/helper-profile", h, {
      published: true,
      topicIds: [],
    });
    expect(generalist.statusCode).toBe(200);
    expect(generalist.json()).toMatchObject({ published: true, topics: [] });
    const withBio = await call("PUT", "/api/me/helper-profile", h, {
      published: true,
      topicIds: [t],
      bio: "Frontend\nlead",
    });
    expect(withBio.statusCode).toBe(400);
    const res = await call("PUT", "/api/me/helper-profile", h, { published: true, topicIds: [t] });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ eligible: true, published: true, bio: null });
    const own = await call("PUT", "/api/me/public-profile", h, {
      directoryVisible: false,
      showSurname: false,
      showPhoto: false,
      showProject: true,
      headline: null,
      locationNote: null,
      bio: "Frontend\nlead",
    });
    expect(own.statusCode).toBe(200);
    expect((await call("GET", "/api/me/helper-profile", h)).json().bio).toBe("Frontend\nlead");
    const pub = await call("GET", "/api/me/public-profile", h);
    expect(pub.json()).toMatchObject({ directoryVisible: false, bio: "Frontend\nlead" });
    expect(pub.json().preview.helpTopics).toEqual([{ id: t, name: "Angular" }]);
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM audit_log WHERE entity_type = 'helper_profile' AND actor_id = $1`,
      [h],
    );
    // The generalist publish and the later topic change are each audited once; repeats are not.
    expect(rows[0].n).toBe(2);
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

describe("H63 helper profile detail", () => {
  it("returns the public-profile entry honouring switches, without scan consent or diary rows", async () => {
    const p = await createUserWithCapabilities(participantCaps);
    const t = await topic("Swift", p);
    const h = await helper([t]);
    await pool.query(`UPDATE users SET surname = 'Garcia' WHERE id = $1`, [h]);
    await pool.query(
      `INSERT INTO user_public_profiles (user_id, headline, bio, location_note, socials, show_surname, show_photo)
       VALUES ($1, 'iOS lead', 'Loves Swift', 'Hall B', '[{"kind":"github","url":"https://github.com/h"}]'::jsonb, false, false)
       ON CONFLICT (user_id) DO UPDATE SET headline = EXCLUDED.headline, bio = EXCLUDED.bio,
         location_note = EXCLUDED.location_note, socials = EXCLUDED.socials`,
      [h],
    );
    await pool.query(
      `INSERT INTO github_accounts (user_id, github_id, login) VALUES ($1, 63, 'linked-helper')`,
      [h],
    );
    const res = await call("GET", `/api/helpdesk/helpers/${h}`, p);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ userId: h, kind: "staff", availableNow: true });
    expect(body.profile).toMatchObject({
      userId: h,
      headline: "iOS lead",
      bio: "Loves Swift",
      locationNote: "Hall B",
      socials: [{ kind: "github", url: "https://github.com/linked-helper" }],
      photoUrl: null,
      cvUrl: null,
      helpTopics: [{ id: t, name: "Swift" }],
    });
    expect(body.profile.displayName.endsWith("G.")).toBe(true);
    expect(Object.keys(body.profile).sort()).toEqual(
      Object.keys((await call("GET", "/api/me/public-profile", h)).json().preview).sort(),
    );
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM diary_entries`);
    expect(rows[0].n).toBe(0);
    await pool.query(`UPDATE user_public_profiles SET show_surname = true WHERE user_id = $1`, [h]);
    const shown = (await call("GET", `/api/helpdesk/helpers/${h}`, p)).json();
    expect(shown.profile.displayName).toContain("Garcia");
  });

  it("answers 404 for unpublished helpers and 403 without a help desk capability", async () => {
    const p = await createUserWithCapabilities(participantCaps);
    const t = await topic("Zig", p);
    const h = await helper([t]);
    await call("PUT", "/api/me/helper-profile", h, { published: false, topicIds: [t] });
    expect((await call("GET", `/api/helpdesk/helpers/${h}`, p)).statusCode).toBe(404);
    const stranger = await createUser();
    expect((await call("GET", `/api/helpdesk/helpers/${h}`, stranger)).statusCode).toBe(403);
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
    expect(res.json()).toMatchObject({ status: "open", routing: "matched", notifiedCount: 2 });
    expect(await outbox(unscheduled)).toHaveLength(1);
    expect(await outbox(match)).toHaveLength(1);
    for (const id of [other, away, left]) expect(await outbox(id)).toHaveLength(0);
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

  it("stays open with routing none when nobody is available, and one active request per person", async () => {
    const p = await createUserWithCapabilities(participantCaps);
    const t = await topic("Go", p);
    await helper([t], { present: false });
    const first = await call("POST", "/api/helpdesk/requests", p, {
      description: "Help",
      location: "Here",
      topicIds: [t],
      other: false,
    });
    expect(first.json()).toMatchObject({ routing: "none", notifiedCount: 0 });
    const dup = await call("POST", "/api/helpdesk/requests", p, {
      description: "Again",
      location: "Here",
      topicIds: [],
      other: true,
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.details.code).toBe("help_request_active");
    const mine = await call("GET", "/api/helpdesk/requests/mine", p);
    expect(mine.json().requests.map((r: { id: number }) => r.id)).toEqual([first.json().id]);
    const outsider = await createUserWithCapabilities(participantCaps);
    expect(
      (await call("GET", `/api/helpdesk/requests/${first.json().id}`, outsider)).statusCode,
    ).toBe(404);
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
    const mate = p;
    const t = await topic(`T-${crypto.randomUUID().slice(0, 6)}`, p);
    const helpers = [await helper([t]), await helper([t]), await helper([t])];
    const res = await call("POST", "/api/helpdesk/requests", p, {
      description: "Stuck",
      location: "Table 4",
      topicIds: [t],
      other: false,
    });
    return { p, mate, helpers, id: res.json().id as number };
  }

  it("lets the requester open the claiming helper's profile, even unpublished, and nobody else", async () => {
    const { p, mate, helpers, id } = await openRequest();
    const [h, other] = helpers as [number, number];
    const unrelated = await createUserWithCapabilities(participantCaps);
    const claim = await call("POST", `/api/helpdesk/requests/${id}/claim`, h, {
      mode: "on_my_way",
    });
    expect(claim.statusCode).toBe(200);
    // Unpublish: the list and ordinary readers lose the helper, the claim keeps them.
    const topics = (await call("GET", "/api/me/helper-profile", h))
      .json()
      .topics.map((x: { id: number }) => x.id);
    await call("PUT", "/api/me/helper-profile", h, { published: false, topicIds: topics });
    for (const viewer of [p, mate]) {
      const res = await call("GET", `/api/helpdesk/helpers/${h}`, viewer);
      expect(res.statusCode).toBe(200);
      expect(res.json().profile.userId).toBe(h);
    }
    expect((await call("GET", `/api/helpdesk/helpers/${h}`, unrelated)).statusCode).toBe(404);
    // A different, unclaimed and unpublished helper stays hidden from the requester.
    await call("PUT", "/api/me/helper-profile", other, { published: false, topicIds: topics });
    expect((await call("GET", `/api/helpdesk/helpers/${other}`, p)).statusCode).toBe(404);
    // Released: the claim no longer grants access.
    await call("POST", `/api/helpdesk/requests/${id}/release`, h);
    expect((await call("GET", `/api/helpdesk/helpers/${h}`, p)).statusCode).toBe(404);
  });

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
    const resolved = await call("POST", `/api/helpdesk/requests/${id}/resolve`, p);
    expect(resolved.json()).toMatchObject({ status: "resolved" });
    expect((await outbox(h2)).filter((notice) => notice.kind === "request_resolved")).toHaveLength(
      1,
    );
    expect((await outbox(p)).filter((notice) => notice.kind === "request_resolved")).toHaveLength(
      0,
    );
    expect((await call("POST", `/api/helpdesk/requests/${id}/resolve`, mate)).statusCode).toBe(409);
    expect((await outbox(h2)).filter((notice) => notice.kind === "request_resolved")).toHaveLength(
      1,
    );
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
  it("aligns default slot boundaries to the step", async () => {
    const h = await helper([
      await topic("Align", await createUserWithCapabilities(participantCaps)),
    ]);
    expect(h).toBeGreaterThan(0);
    const cov = await createUserWithCapabilities([CAPABILITIES.HELPDESK_COVERAGE]);
    for (const step of [60, 30]) {
      const body = (await call("GET", `/api/helpdesk/coverage?stepMinutes=${step}`, cov)).json();
      const ms = step * 60_000;
      expect(Date.parse(body.from) % ms).toBe(0);
      expect(Date.parse(body.to) % ms).toBe(0);
      expect(body.slots[0].startsAt).toBe(body.from);
    }
  });

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
    expect(body.now).toMatchObject({ scheduled: 2, present: 2, available: 2 });
    expect(body.now.topics).toEqual(
      expect.arrayContaining([
        { id: fe, name: "Frontend", scheduled: 2, available: 1 },
        { id: ml, name: "ML", scheduled: 0, available: 1 },
      ]),
    );
    const participant = await createUserWithCapabilities(participantCaps);
    expect((await call("GET", "/api/helpdesk/coverage", participant)).statusCode).toBe(403);
  });
});

/** H64-H65 challenge-specific help and sponsor preference. */
describe("H64-H65 challenge help and sponsor preference", () => {
  /** A sponsor helper (published, available, present) of a fresh enterprise. */
  async function sponsorHelper(
    enterpriseId: number,
    topicIds: number[],
    opts: { limitTo?: number[] } = {},
  ) {
    const id = await helper(topicIds);
    await pool.query(`INSERT INTO sponsors (enterprise_id, user_id) VALUES ($1, $2)`, [
      enterpriseId,
      id,
    ]);
    if (opts.limitTo) {
      const res = await call("PUT", "/api/me/helper-profile", id, {
        published: true,
        topicIds,
        challengeIds: opts.limitTo,
      });
      expect(res.statusCode).toBe(200);
    }
    return id;
  }
  async function enterprise(): Promise<number> {
    const { rows } = await pool.query(`INSERT INTO enterprises (name) VALUES ($1) RETURNING id`, [
      `Ent ${crypto.randomUUID()}`,
    ]);
    return rows[0].id as number;
  }
  async function challenge(
    enterpriseId: number,
    opts: { visibility?: string; test?: boolean } = {},
  ): Promise<number> {
    // The author is any sponsor row of the enterprise; create a throwaway one.
    const owner = await createUser();
    const { rows: sp } = await pool.query(
      `INSERT INTO sponsors (enterprise_id, user_id) VALUES ($1, $2) RETURNING id`,
      [enterpriseId, owner],
    );
    const { rows } = await pool.query(
      `INSERT INTO challenges (author, title, visibility, is_test_account)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [
        sp[0].id,
        `Challenge ${crypto.randomUUID().slice(0, 6)}`,
        opts.visibility ?? "visible",
        opts.test ?? false,
      ],
    );
    return rows[0].id as number;
  }
  const ask = (p: number, extra: Record<string, unknown>) =>
    call("POST", "/api/helpdesk/requests", p, {
      description: "Need a hand",
      location: "Table 3",
      topicIds: [],
      other: true,
      ...extra,
    });

  it("lists visible challenges with the requester's project challenges first", async () => {
    const e = await enterprise();
    const a = await challenge(e);
    const b = await challenge(e);
    await challenge(e, { visibility: "hidden" });
    await challenge(e, { test: true });
    const p = await createUserWithCapabilities(participantCaps);
    const repo = await team([p]);
    await pool.query(`INSERT INTO queue_entries (challenge_id, repo_id) VALUES ($1, $2)`, [
      b,
      repo,
    ]);
    const res = await call("GET", "/api/helpdesk/challenges", p);
    expect(res.statusCode).toBe(200);
    const list = res.json().challenges as { id: number; name: string; mine: boolean }[];
    expect(list.map((c) => c.id)).toEqual([b, a]);
    expect(list.map((c) => c.mine)).toEqual([true, false]);
    const nobody = await createUser();
    expect((await call("GET", "/api/helpdesk/challenges", nobody)).statusCode).toBe(403);
  });

  it("stores the challenge and sponsor preference and rejects unusable challenges", async () => {
    const e = await enterprise();
    const c = await challenge(e);
    const p = await createUserWithCapabilities(participantCaps);
    const bad = await ask(p, { challengeId: await challenge(e, { visibility: "hidden" }) });
    expect(bad.statusCode).toBe(400);
    expect((await ask(p, { challengeId: await challenge(e, { test: true }) })).statusCode).toBe(
      400,
    );
    expect((await ask(p, { challengeId: 999_999 })).statusCode).toBe(400);
    const ok = await ask(p, { challengeId: c, preferSponsor: true });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({ challenge: { id: c }, preferSponsor: true });
    const plain = await createUserWithCapabilities(participantCaps);
    const none = await ask(plain, {});
    expect(none.json()).toMatchObject({ challenge: null, preferSponsor: false });
    const mine = await call("GET", "/api/helpdesk/requests/mine", p);
    expect(mine.json().requests[0]).toMatchObject({ challenge: { id: c } });
  });

  it("matches sponsors of the challenge regardless of topic, besides topic matches", async () => {
    const e = await enterprise();
    const c = await challenge(e);
    const p = await createUserWithCapabilities(participantCaps);
    const fe = await topic("Frontend", p);
    const be = await topic("Backend", p);
    const sponsor = await sponsorHelper(e, [be]);
    const topical = await helper([fe]);
    const unrelated = await helper([be]);
    const res = await ask(p, { other: false, topicIds: [fe], challengeId: c });
    expect(res.json()).toMatchObject({ routing: "matched", notifiedCount: 2 });
    expect(await outbox(sponsor)).toHaveLength(1);
    expect(await outbox(topical)).toHaveLength(1);
    expect(await outbox(unrelated)).toHaveLength(0);
  });

  it("limits helpers who chose challenges to those in routing, inbox and claims", async () => {
    const mine = await enterprise();
    const theirs = await enterprise();
    const myChallenge = await challenge(mine);
    const otherChallenge = await challenge(theirs);
    const p1 = await createUserWithCapabilities(participantCaps);
    const p2 = await createUserWithCapabilities(participantCaps);
    const p3 = await createUserWithCapabilities(participantCaps);
    const t = await topic("Infra", p1);
    const myChallenge2 = await challenge(mine);
    const limited = await sponsorHelper(mine, [t], { limitTo: [myChallenge, myChallenge2] });

    const foreign = await ask(p1, { other: false, topicIds: [t], challengeId: otherChallenge });
    const noChallenge = await ask(p2, { other: false, topicIds: [t] });
    const own = await ask(p3, { other: false, topicIds: [t], challengeId: myChallenge });
    expect(foreign.json().routing).toBe("none");
    expect(noChallenge.json().routing).toBe("none");
    expect(own.json()).toMatchObject({ routing: "matched", notifiedCount: 1 });
    expect(await outbox(limited)).toHaveLength(1);

    const inbox = await call("GET", "/api/helpdesk/inbox?scope=open", limited);
    expect(inbox.json().requests.map((r: { id: number }) => r.id)).toEqual([own.json().id]);

    const hiddenGet = await call("GET", `/api/helpdesk/requests/${foreign.json().id}`, limited);
    expect(hiddenGet.statusCode).toBe(404);
    const hiddenClaim = await call(
      "POST",
      `/api/helpdesk/requests/${foreign.json().id}/claim`,
      limited,
      { mode: "on_my_way" },
    );
    expect(hiddenClaim.statusCode).toBe(404);
    const claim = await call("POST", `/api/helpdesk/requests/${own.json().id}/claim`, limited, {
      mode: "on_my_way",
    });
    expect(claim.statusCode).toBe(200);

    // Turning the limit off restores the full inbox.
    const off = await call("PUT", "/api/me/helper-profile", limited, {
      published: true,
      topicIds: [t],
      challengeIds: [],
    });
    expect(off.json().challengeIds).toEqual([]);
    const all = await call("GET", "/api/helpdesk/inbox?scope=open", limited);
    expect(all.json().requests).toHaveLength(2);
  });

  it("routes only to sponsors with preferSponsor, else normally", async () => {
    const e = await enterprise();
    const c = await challenge(e);
    const p1 = await createUserWithCapabilities(participantCaps);
    const p2 = await createUserWithCapabilities(participantCaps);
    const p3 = await createUserWithCapabilities(participantCaps);
    const t = await topic("Mobile", p1);
    const mentor = await helper([t]);

    // No sponsor available: normal routing, no `sponsor` outcome.
    const invalid = await ask(p1, { other: false, topicIds: [t], preferSponsor: true });
    expect(invalid.statusCode).toBe(400);
    const without = await ask(p1, {
      challengeId: c,
      other: false,
      topicIds: [t],
      preferSponsor: true,
    });
    expect(without.json()).toMatchObject({ routing: "matched", notifiedCount: 1 });
    expect(await outbox(mentor)).toHaveLength(1);

    const sponsor = await sponsorHelper(e, [t]);
    // A sponsor of another company must not win the chosen challenge preference.
    const unrelated = await sponsorHelper(await enterprise(), [t]);
    const byTopic = await ask(p2, {
      challengeId: c,
      other: false,
      topicIds: [t],
      preferSponsor: true,
    });
    expect(byTopic.json()).toMatchObject({ routing: "sponsor", notifiedCount: 1 });
    // Sponsor matched by challenge, with Other.
    const byChallenge = await ask(p3, { challengeId: c, preferSponsor: true });
    expect(byChallenge.json()).toMatchObject({ routing: "sponsor", notifiedCount: 1 });
    expect(await outbox(sponsor)).toHaveLength(2);
    expect(await outbox(unrelated)).toHaveLength(0);
    expect(await outbox(mentor)).toHaveLength(1);

    // An unavailable sponsor does not count.
    const p4 = await createUserWithCapabilities(participantCaps);
    await exit(sponsor);
    const away = await ask(p4, {
      challengeId: c,
      other: false,
      topicIds: [t],
      preferSponsor: true,
    });
    expect(away.json().routing).toBe("matched");
  });

  it("lets any eligible helper choose challenges and validates them", async () => {
    const e = await enterprise();
    const c1 = await challenge(e);
    const c2 = await challenge(e);
    const hidden = await challenge(e, { visibility: "hidden" });
    const t = await topic("Cloud", await createUserWithCapabilities(participantCaps));
    const mentor = await helper([t]);
    const profile = (await call("GET", "/api/me/helper-profile", mentor)).json();
    expect(profile.challengeIds).toEqual([]);
    expect(profile.challenges).toEqual([]);
    expect(profile.challengeOptions.map((o: { id: number }) => o.id).sort()).toEqual(
      [c1, c2].sort(),
    );
    expect(profile).not.toHaveProperty("ownChallengesOnly");

    const foreign = await call("PUT", "/api/me/helper-profile", mentor, {
      published: true,
      topicIds: [t],
      challengeIds: [c1, hidden, 999999],
    });
    expect(foreign.statusCode).toBe(400);

    const ok = await call("PUT", "/api/me/helper-profile", mentor, {
      published: true,
      topicIds: [t],
      challengeIds: [c2, c1, c2],
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().challengeIds).toEqual([c1, c2].sort((a, b) => a - b));
    expect(ok.json().challenges).toHaveLength(2);
    expect(ok.json().preview.challenges).toHaveLength(2);
    const detail = await call("GET", `/api/helpdesk/helpers/${mentor}`, mentor);
    expect(detail.json().challenges).toHaveLength(2);
    const { rows } = await pool.query(
      `SELECT after FROM audit_log WHERE entity_type = 'helper_profile' AND entity_id = $1
        ORDER BY id DESC LIMIT 1`,
      [mentor],
    );
    expect(rows[0].after.changedFields).toContain("challengeIds");

    // Omitting the field keeps the stored set; [] clears it.
    const keep = await call("PUT", "/api/me/helper-profile", mentor, {
      published: true,
      topicIds: [t],
    });
    expect(keep.json().challengeIds).toHaveLength(2);
    const clear = await call("PUT", "/api/me/helper-profile", mentor, {
      published: true,
      topicIds: [t],
      challengeIds: [],
    });
    expect(clear.json().challengeIds).toEqual([]);
  });

  it("routes only requests about the chosen challenges to a limited mentor", async () => {
    const e = await enterprise();
    const chosen = await challenge(e);
    const other = await challenge(e);
    const p1 = await createUserWithCapabilities(participantCaps);
    const p2 = await createUserWithCapabilities(participantCaps);
    const p3 = await createUserWithCapabilities(participantCaps);
    const t = await topic("Rust", p1);
    const mentor = await helper([t]);
    const set = await call("PUT", "/api/me/helper-profile", mentor, {
      published: true,
      topicIds: [t],
      challengeIds: [chosen],
    });
    expect(set.statusCode).toBe(200);
    const off = await ask(p1, { other: false, topicIds: [t], challengeId: other });
    const none = await ask(p2, { other: false, topicIds: [t] });
    const on = await ask(p3, { other: false, topicIds: [t], challengeId: chosen });
    expect(off.json().routing).toBe("none");
    expect(none.json().routing).toBe("none");
    expect(on.json()).toMatchObject({ routing: "matched", notifiedCount: 1 });
    const inbox = await call("GET", "/api/helpdesk/inbox?scope=open", mentor);
    expect(inbox.json().requests.map((r: { id: number }) => r.id)).toEqual([on.json().id]);
  });

  it("does not alert a sponsor who limited to other challenges, regardless of topic", async () => {
    const mine = await enterprise();
    const theirs = await enterprise();
    const myChallenge = await challenge(mine);
    const otherChallenge = await challenge(theirs);
    const p = await createUserWithCapabilities(participantCaps);
    const t = await topic("Go", p);
    const sponsor = await sponsorHelper(mine, [t], { limitTo: [otherChallenge] });
    const res = await ask(p, { other: false, topicIds: [t], challengeId: myChallenge });
    expect(res.json().routing).toBe("none");
    expect(await outbox(sponsor)).toHaveLength(0);
  });
});

describe("H61-H62 publishing shares the profile and suggests an interval", () => {
  it("shares the public profile when publishing, not undone by unpublishing", async () => {
    const t = await topic("Zig", await createUserWithCapabilities(participantCaps));
    const id = await createUserWithCapabilities(helperCaps);
    const visible = async () =>
      (
        await pool.query(`SELECT directory_visible FROM user_public_profiles WHERE user_id = $1`, [
          id,
        ])
      ).rows[0]?.directory_visible ?? false;
    expect(await visible()).toBe(false);
    const on = await call("PUT", "/api/me/helper-profile", id, { published: true, topicIds: [t] });
    expect(on.statusCode).toBe(200);
    expect(await visible()).toBe(true);
    const { rows } = await pool.query(
      `SELECT after FROM audit_log WHERE entity_type = 'helper_profile' AND entity_id = $1
        ORDER BY id DESC LIMIT 1`,
      [id],
    );
    expect(rows[0].after.changedFields).toContain("directoryVisible");
    await call("PUT", "/api/me/helper-profile", id, { published: false, topicIds: [t] });
    expect(await visible()).toBe(true);
    // The person unshares later; a topic edit while published does not reshare.
    await call("PUT", "/api/me/helper-profile", id, { published: true, topicIds: [t] });
    await pool.query(
      `UPDATE user_public_profiles SET directory_visible = false WHERE user_id = $1`,
      [id],
    );
    await call("PUT", "/api/me/helper-profile", id, { published: true, topicIds: [t] });
    expect(await visible()).toBe(false);
  });

  it("rejects availability starting before the hacking window (H62)", async () => {
    const id = await createUserWithCapabilities(helperCaps);
    await pool.query(`INSERT INTO event_config (id) VALUES (1) ON CONFLICT DO NOTHING`);
    await pool.query(
      `UPDATE event_config SET event_starts_at = '2030-01-01T08:00:00Z',
              event_ends_at = '2030-01-03T08:00:00Z',
              hacking_starts_at = '2030-01-01T12:00:00Z',
              hacking_ends_at = '2030-01-02T12:00:00Z' WHERE id = 1`,
    );
    const put = (startsAt: string, endsAt: string) =>
      call("PUT", "/api/me/helper-profile/availability", id, { intervals: [{ startsAt, endsAt }] });
    const early = await put("2030-01-01T11:00:00Z", "2030-01-01T13:00:00Z");
    expect(early.statusCode).toBe(400);
    expect(early.json().error.details.code).toBe("availability_before_window");
    expect((await put("2030-01-01T12:00:00Z", "2030-01-01T14:00:00Z")).statusCode).toBe(200);
    // Without hacking bounds the event start is the limit.
    await pool.query(
      `UPDATE event_config SET hacking_starts_at = NULL, hacking_ends_at = NULL WHERE id = 1`,
    );
    expect((await put("2030-01-01T07:00:00Z", "2030-01-01T09:00:00Z")).statusCode).toBe(400);
    expect((await put("2030-01-01T08:00:00Z", "2030-01-01T09:00:00Z")).statusCode).toBe(200);
    // No window, no restriction.
    await pool.query(
      `UPDATE event_config SET event_starts_at = NULL, event_ends_at = NULL WHERE id = 1`,
    );
    expect((await put("2020-01-01T07:00:00Z", "2020-01-01T09:00:00Z")).statusCode).toBe(200);
  });

  it("suggests the hacking window, else the event window, else null", async () => {
    const id = await createUserWithCapabilities(helperCaps);
    const read = async () => (await call("GET", "/api/me/helper-profile", id)).json();
    await pool.query(`INSERT INTO event_config (id) VALUES (1) ON CONFLICT DO NOTHING`);
    await pool.query(
      `UPDATE event_config SET hacking_starts_at = NULL, hacking_ends_at = NULL,
              event_starts_at = NULL, event_ends_at = NULL WHERE id = 1`,
    );
    expect((await read()).suggestedInterval).toBeNull();
    await pool.query(
      `UPDATE event_config SET event_starts_at = '2030-01-01T08:00:00Z',
              event_ends_at = '2030-01-03T08:00:00Z' WHERE id = 1`,
    );
    expect((await read()).suggestedInterval).toEqual({
      startsAt: "2030-01-01T08:00:00.000Z",
      endsAt: "2030-01-03T08:00:00.000Z",
    });
    await pool.query(
      `UPDATE event_config SET hacking_starts_at = '2030-01-01T12:00:00Z',
              hacking_ends_at = '2030-01-02T12:00:00Z' WHERE id = 1`,
    );
    expect((await read()).suggestedInterval).toEqual({
      startsAt: "2030-01-01T12:00:00.000Z",
      endsAt: "2030-01-02T12:00:00.000Z",
    });
  });

  it("lets help desk readers download a published helper's shared CV like a badge scanner", async () => {
    const p = await createUserWithCapabilities(participantCaps);
    const t = await topic("Elixir", p);
    const h = await helper([t]);
    await admitParticipant(h);
    const pdf = Buffer.from("%PDF-1.7\n% helper cv\n%%EOF\n");
    const boundary = `----hd-${crypto.randomUUID()}`;
    const up = await app.inject({
      method: "POST",
      url: "/api/me/public-profile/cv",
      headers: {
        ...asUser(h),
        "content-type": `multipart/form-data; boundary=${boundary}`,
        "idempotency-key": key(),
      },
      payload: Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="Helper CV.pdf"\r\nContent-Type: application/pdf\r\n\r\n`,
        ),
        pdf,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]),
    });
    expect(up.statusCode).toBe(200);
    const before = (await call("GET", `/api/helpdesk/helpers/${h}`, p)).json();
    expect(before.profile.cvUrl).toBeNull();
    await pool.query(`UPDATE user_public_profiles SET share_cv = true WHERE user_id = $1`, [h]);
    const shared = (await call("GET", `/api/helpdesk/helpers/${h}`, p)).json();
    expect(shared.profile.cvUrl).toBe(`/api/directory/${h}/cv`);
    const download = await call("GET", shared.profile.cvUrl, p);
    expect(download.statusCode).toBe(200);
    expect(download.rawPayload.equals(pdf)).toBe(true);
  });
});

/** H64, H66: helpers see the public profile of whoever asks them for help. */
describe("H64-H66 requester profile for helpers", () => {
  async function share(userId: number, opts: { photo?: boolean } = {}) {
    await admitParticipant(userId);
    await pool.query(
      `INSERT INTO user_public_profiles (user_id, directory_visible, headline, show_photo, consented_at)
       VALUES ($1, true, 'Needs a hand', $2, now())
       ON CONFLICT (user_id) DO UPDATE SET directory_visible = true, headline = 'Needs a hand',
         show_photo = EXCLUDED.show_photo`,
      [userId, opts.photo ?? false],
    );
  }
  async function ask(requester: number, t: number) {
    const res = await call("POST", "/api/helpdesk/requests", requester, {
      description: "Stuck",
      location: "Table 4",
      topicIds: [t],
      other: false,
    });
    expect(res.statusCode).toBe(201);
    return res.json().id as number;
  }

  it("shows the profile to routed helpers, the claimer and managers; null for others or when not shared", async () => {
    const p = await createUserWithCapabilities(participantCaps);
    const t = await topic("Elm", p);
    const routed = await helper([t]);
    const unrouted = await helper([await topic("Other1")], { scheduled: false, present: false });
    const manager = await createUserWithCapabilities([CAPABILITIES.HELPDESK_MANAGE]);
    const coverage = await createUserWithCapabilities([CAPABILITIES.HELPDESK_COVERAGE]);
    const id = await ask(p, t);

    // Requester does not share yet: name only, no profile.
    const hidden = await call("GET", `/api/helpdesk/requests/${id}`, routed);
    expect(hidden.json().requesterProfile).toBeNull();
    expect(hidden.json().requester.userId).toBe(p);

    await share(p);
    const seen = await call("GET", `/api/helpdesk/requests/${id}`, routed);
    expect(seen.json().requesterProfile).toMatchObject({
      userId: p,
      headline: "Needs a hand",
      cvUrl: null,
    });
    expect(
      (await call("GET", `/api/helpdesk/requests/${id}`, manager)).json().requesterProfile,
    ).toMatchObject({ userId: p });
    // Coverage readers see the request but not the profile; the requester needs none.
    expect(
      (await call("GET", `/api/helpdesk/requests/${id}`, coverage)).json().requesterProfile,
    ).toBeNull();
    expect(
      (await call("GET", `/api/helpdesk/requests/${id}`, p)).json().requesterProfile,
    ).toBeNull();
    // A helper who was not routed (eligible, but not notified) gets none.
    const other = (await call("GET", `/api/helpdesk/requests/${id}`, unrouted)).json();
    expect(other.requesterProfile).toBeNull();

    await call("POST", `/api/helpdesk/requests/${id}/claim`, routed, { mode: "on_my_way" });
    await call("POST", `/api/helpdesk/requests/${id}/resolve`, p);
    expect(
      (await call("GET", `/api/helpdesk/requests/${id}`, routed)).json().requesterProfile,
    ).toMatchObject({ userId: p });
    // The read creates no diary contact.
    const { rows } = await pool.query(`SELECT 1 FROM diary_entries WHERE owner_id = $1`, [routed]);
    expect(rows).toHaveLength(0);
  });

  it("serves the requester's photo and CV routes only to those viewers", async () => {
    const p = await createUserWithCapabilities(participantCaps);
    const t = await topic("Nim", p);
    const routed = await helper([t]);
    const unrelated = await helper([await topic("Other2")], { scheduled: false, present: false });
    await share(p, { photo: true });
    await ask(p, t);
    // Neither has a stored file, so allowed viewers get 404 from the missing
    // object while unrelated ones are refused earlier with the same status;
    // the CV route is the observable difference: shared flag off → 404 for all.
    const cvRouted = await call("GET", `/api/directory/${p}/cv`, routed);
    const cvUnrelated = await call("GET", `/api/directory/${p}/cv`, unrelated);
    expect(cvRouted.statusCode).toBe(404);
    expect(cvUnrelated.statusCode).toBe(404);
    const pdf = Buffer.from("%PDF-1.4\n%%EOF\n");
    const stored = `profiles/${p}/cv/${crypto.randomUUID().replaceAll("-", "")}.pdf`;
    try {
      const { putObject } = await import("../../src/lib/storage.js");
      await putObject(stored, pdf, "application/pdf");
    } catch {
      return; // no object store (bucket) in this environment: nothing more to observe
    }
    await pool.query(
      `UPDATE user_public_profiles SET share_cv = true, cv_key = $2, cv_filename = 'cv.pdf', cv_uploaded_at = now()
        WHERE user_id = $1`,
      [p, stored],
    );
    const ok = await call("GET", `/api/directory/${p}/cv`, routed);
    expect(ok.statusCode).toBe(200);
    expect(ok.rawPayload.equals(pdf)).toBe(true);
    expect((await call("GET", `/api/directory/${p}/cv`, unrelated)).statusCode).toBe(404);
    // Requester stops sharing: the same viewer loses the CV.
    await pool.query(
      `UPDATE user_public_profiles SET directory_visible = false WHERE user_id = $1`,
      [p],
    );
    expect((await call("GET", `/api/directory/${p}/cv`, routed)).statusCode).toBe(404);
  });

  it("keeps a limited sponsor away from requests without their challenge", async () => {
    const p = await createUserWithCapabilities(participantCaps);
    const t = await topic("Go2", p);
    const sponsor = await helper([t]);
    const { rows: ent } = await pool.query(
      `INSERT INTO enterprises (name) VALUES ($1) RETURNING id`,
      [`Ent ${crypto.randomUUID()}`],
    );
    await pool.query(`INSERT INTO sponsors (enterprise_id, user_id) VALUES ($1, $2)`, [
      ent[0].id,
      sponsor,
    ]);
    const { rows: sp } = await pool.query(`SELECT id FROM sponsors WHERE user_id = $1`, [sponsor]);
    const { rows: ch } = await pool.query(
      `INSERT INTO challenges (author, title, visibility) VALUES ($1, 'Mine', 'visible') RETURNING id`,
      [sp[0].id],
    );
    const limited = await call("PUT", "/api/me/helper-profile", sponsor, {
      published: true,
      topicIds: [t],
      challengeIds: [ch[0].id],
    });
    expect(limited.statusCode).toBe(200);
    await share(p);
    const id = await ask(p, t); // no challenge: never routed to the limited sponsor
    expect((await call("GET", `/api/helpdesk/requests/${id}`, sponsor)).statusCode).toBe(404);
    expect((await call("GET", `/api/directory/${p}/cv`, sponsor)).statusCode).toBe(404);
  });
});

describe("H66 resolved request as presence checkpoint", () => {
  async function resolved(opts: { door: boolean; cancel?: boolean }) {
    const p = await createUserWithCapabilities(participantCaps);
    const t = await topic("Scala", p);
    const h = await helper([t], { present: false });
    if (opts.door) {
      await enter(p);
      await pool.query(
        `UPDATE time_logs SET scanned_at = now() - interval '2 hours' WHERE user_id = $1`,
        [p],
      );
    }
    const res = await call("POST", "/api/helpdesk/requests", p, {
      description: "x",
      location: "y",
      topicIds: [t],
      other: false,
    });
    const id = res.json().id as number;
    await call("POST", `/api/helpdesk/requests/${id}/claim`, h, { mode: "on_my_way" });
    await call("POST", `/api/helpdesk/requests/${id}/${opts.cancel ? "cancel" : "resolve"}`, p);
    return { p, h };
  }
  const timeline = async (userId: number) => {
    const { presenceTimeline } = await import("../../src/modules/logistics/presence.js");
    return presenceTimeline(userId, { actorId: null });
  };

  it("secures the requester's door window and adds a help signal for both sides", async () => {
    const { p, h } = await resolved({ door: true });
    const tl = await timeline(p);
    expect(tl.signals.map((s) => s.source)).toEqual(["door", "help"]);
    expect(tl.signals[1]).toMatchObject({ kind: "help", category: "helpdesk", activityName: null });
    expect(tl.windows[0]).toMatchObject({ status: "secured", closedBy: "help" });
    expect(tl.conflicts).toHaveLength(0);
    // The helper has no door entry: the signal is listed but opens nothing.
    const other = await timeline(h);
    expect(other.signals.map((s) => s.source)).toEqual(["help"]);
  });

  it("creates no presence without a door window", async () => {
    const { p, h } = await resolved({ door: false });
    for (const id of [p, h]) {
      const tl = await timeline(id);
      expect(tl.signals.filter((s) => s.source === "help")).toHaveLength(1);
      expect(tl.windows.filter((w) => w.openedBy === "help")).toHaveLength(0);
    }
    const { userHours } = await import("../../src/modules/logistics/presence.js");
    expect((await userHours(p, { actorId: null })).intervals).toHaveLength(0);
  });

  it("counts nothing for a cancelled request", async () => {
    const { p } = await resolved({ door: true, cancel: true });
    const tl = await timeline(p);
    expect(tl.signals.map((s) => s.source)).toEqual(["door"]);
  });
});

describe("H63 own preview equals the public helper view", () => {
  it("carries the card plus profile entry, even unpublished", async () => {
    const h = await createUserWithCapabilities(helperCaps);
    await pool.query(
      `INSERT INTO user_public_profiles (user_id, headline, show_surname) VALUES ($1, 'Mentor', false)`,
      [h],
    );
    const mine = (await call("GET", "/api/me/helper-profile", h)).json();
    expect(mine.published).toBe(false);
    expect(mine.preview).toMatchObject({ userId: h, profile: { userId: h, headline: "Mentor" } });
    const t = await topic("Prev");
    await call("PUT", "/api/me/helper-profile", h, { published: true, topicIds: [t] });
    const viewer = await createUserWithCapabilities(participantCaps);
    const theirs = (await call("GET", `/api/helpdesk/helpers/${h}`, viewer)).json();
    const own = (await call("GET", "/api/me/helper-profile", h)).json().preview;
    expect(own.profile).toEqual(theirs.profile);
  });
});

/** H64-H65: first come, first served queue and editing an open request. */
describe("H64-H65 queue order and request edits", () => {
  async function ask(requester: number, topicIds: number[], extra: Record<string, unknown> = {}) {
    const res = await call("POST", "/api/helpdesk/requests", requester, {
      description: "Stuck",
      location: "Table 4",
      topicIds,
      other: topicIds.length === 0,
      ...extra,
    });
    expect(res.statusCode).toBe(201);
    return res.json() as { id: number };
  }
  const edit = (id: number, as: number, payload: Record<string, unknown>) =>
    call("PATCH", `/api/helpdesk/requests/${id}`, as, payload);

  it("lists open requests oldest first and moves an edited one to the end", async () => {
    const t = await topic("Queue1");
    const h = await helper([t]);
    const [a, b, c] = [
      await createUserWithCapabilities(participantCaps),
      await createUserWithCapabilities(participantCaps),
      await createUserWithCapabilities(participantCaps),
    ] as [number, number, number];
    const ra = await ask(a, [t]);
    const rb = await ask(b, [t]);
    const rc = await ask(c, [t]);
    const order = async () =>
      (await call("GET", "/api/helpdesk/inbox?scope=open", h))
        .json()
        .requests.map((r: { id: number; queuePosition: number }) => [r.id, r.queuePosition]);
    expect(await order()).toEqual([
      [ra.id, 1],
      [rb.id, 2],
      [rc.id, 3],
    ]);
    const edited = await edit(ra.id, a, {
      description: "Still stuck",
      location: "Table 9",
      topicIds: [t],
      other: false,
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json()).toMatchObject({
      description: "Still stuck",
      location: "Table 9",
      queuePosition: 3,
      viewer: { canEdit: true },
    });
    expect((await order()).map(([id]: number[]) => id)).toEqual([rb.id, rc.id, ra.id]);
    const { rows } = await pool.query(
      `SELECT queued_at > created_at AS moved FROM help_requests WHERE id = $1`,
      [ra.id],
    );
    expect(rows[0].moved).toBe(true);
    const audit = await pool.query(
      `SELECT after FROM audit_log WHERE entity_type = 'help_request' AND entity_id = $1
        AND action = 'edited'`,
      [String(ra.id)],
    );
    expect(audit.rows[0].after.changedFields.sort()).toEqual(["description", "location"]);
  });

  it("re-routes: notifies newly matched helpers once and nobody twice", async () => {
    const t1 = await topic("Route1");
    const t2 = await topic("Route2");
    const h1 = await helper([t1]);
    const h2 = await helper([t2]);
    const p = await createUserWithCapabilities(participantCaps);
    const r = await ask(p, [t1]);
    expect(await outbox(h1)).toHaveLength(1);
    expect(await outbox(h2)).toHaveLength(0);
    const res = await edit(r.id, p, {
      description: "Now both",
      location: "Table 4",
      topicIds: [t1, t2],
      other: false,
    });
    expect(res.statusCode).toBe(200);
    expect(await outbox(h1)).toHaveLength(1);
    expect(await outbox(h2)).toHaveLength(1);
    await edit(r.id, p, {
      description: "Again",
      location: "Table 4",
      topicIds: [t1, t2],
      other: false,
    });
    expect(await outbox(h1)).toHaveLength(1);
    expect(await outbox(h2)).toHaveLength(1);
    expect(res.json().notifiedCount).toBe(2);
  });

  it("validates like creation and keeps outsiders and closed requests out", async () => {
    const t = await topic("Valid1");
    const h = await helper([t]);
    const p = await createUserWithCapabilities(participantCaps);
    const stranger = await createUserWithCapabilities(participantCaps);
    const r = await ask(p, [t]);
    const base = { description: "x", location: "y", topicIds: [t], other: false };
    expect((await edit(r.id, p, { ...base, topicIds: [], other: false })).statusCode).toBe(400);
    expect((await edit(r.id, p, { ...base, description: "" })).statusCode).toBe(400);
    expect((await edit(r.id, p, { ...base, topicIds: [999999] })).statusCode).toBe(400);
    expect((await edit(r.id, p, { ...base, challengeId: 999999 })).statusCode).toBe(400);
    expect((await edit(r.id, stranger, base)).statusCode).toBe(404);
    expect((await edit(r.id, h, base)).statusCode).toBe(404);
    await call("POST", `/api/helpdesk/requests/${r.id}/claim`, h, { mode: "on_my_way" });
    const claimed = await edit(r.id, p, base);
    expect(claimed.statusCode).toBe(409);
    expect(claimed.json().error.details.code).toBe("help_request_already_claimed");
    await call("POST", `/api/helpdesk/requests/${r.id}/resolve`, p);
    const closed = await edit(r.id, p, base);
    expect(closed.statusCode).toBe(409);
    expect(closed.json().error.details.code).toBe("help_request_closed");
    const view = (await call("GET", `/api/helpdesk/requests/${r.id}`, p)).json();
    expect(view.viewer.canEdit).toBe(false);
    expect(view.queuePosition).toBeNull();
  });

  it("serializes a simultaneous claim and edit", async () => {
    const t = await topic("Race1");
    const h = await helper([t]);
    const p = await createUserWithCapabilities(participantCaps);
    const r = await ask(p, [t]);
    const [claim, editRes] = await Promise.all([
      call("POST", `/api/helpdesk/requests/${r.id}/claim`, h, { mode: "on_my_way" }),
      edit(r.id, p, {
        description: "Edited",
        location: "Table 4",
        topicIds: [t],
        other: false,
      }),
    ]);
    expect(claim.statusCode).toBe(200);
    const { rows } = await pool.query(
      "SELECT status, description FROM help_requests WHERE id = $1",
      [r.id],
    );
    expect(rows[0].status).toBe("claimed");
    // Either the edit won the lock (and the claim took the edited request)
    // or the claim won and the edit was refused: never an edit on a claim.
    if (editRes.statusCode === 200) expect(rows[0].description).toBe("Edited");
    else {
      expect(editRes.statusCode).toBe(409);
      expect(rows[0].description).toBe("Stuck");
    }
  });
});

describe("H8, H63 support public roles", () => {
  it("shows the highest visible assigned role without leaking hidden roles", async () => {
    const t = await topic("Public roles");
    const h = await helper([t]);
    const p = await createUserWithCapabilities(participantCaps);
    const lower = await createRole([], { name: "Technical support" });
    const higher = await createRole([], { name: "Event lead" });
    const hidden = await createRole([], { name: "Private administrator", isVisible: false });
    await pool.query("UPDATE roles SET position = 2147483000 WHERE id = $1", [lower]);
    await pool.query("UPDATE roles SET position = 2147483001 WHERE id = $1", [higher]);
    await pool.query("UPDATE roles SET position = 2147483002 WHERE id = $1", [hidden]);
    await pool.query("INSERT INTO user_roles (user_id, role_id) SELECT $1, unnest($2::int[])", [
      h,
      [lower, higher, hidden],
    ]);
    const list = await call("GET", "/api/helpdesk/helpers", p);
    expect(
      list.json().helpers.find((person: { userId: number }) => person.userId === h).visibleRoleName,
    ).toBe("Event lead");
    const detail = await call("GET", `/api/helpdesk/helpers/${h}`, p);
    expect(detail.json()).toMatchObject({ visibleRoleName: "Event lead", affiliation: null });
    await pool.query("UPDATE roles SET is_visible = false WHERE id = $1", [higher]);
    expect((await call("GET", `/api/helpdesk/helpers/${h}`, p)).json().visibleRoleName).toBe(
      "Technical support",
    );
  });
});

/** H64: opening hours gate only the creation of new requests. */
describe("H64 opening hours", () => {
  const manageCaps = [CAPABILITIES.HELPDESK_MANAGE];
  const win = (fromH: number, toH: number) => ({
    startsAt: new Date(Date.now() + fromH * hour).toISOString(),
    endsAt: new Date(Date.now() + toH * hour).toISOString(),
  });
  const body = { description: "Stuck", location: "Table 4", topicIds: [], other: true };

  it("is always open until windows are configured", async () => {
    const p = await createUser();
    const res = await call("GET", "/api/helpdesk/schedule", p);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      configured: false,
      open: true,
      windows: [],
      nextChangeAt: null,
    });
    expect((await app.inject({ method: "GET", url: "/api/helpdesk/schedule" })).statusCode).toBe(
      401,
    );
  });

  it("stores sorted windows, reports state and clears them", async () => {
    const m = await createUserWithCapabilities(manageCaps);
    const later = win(5, 6);
    const now = win(-1, 2);
    const put = await call("PUT", "/api/helpdesk/schedule", m, { windows: [later, now] });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({
      configured: true,
      open: true,
      windows: [now, later],
      nextChangeAt: now.endsAt,
    });
    const closed = await call("PUT", "/api/helpdesk/schedule", m, { windows: [later] });
    expect(closed.json()).toMatchObject({ open: false, nextChangeAt: later.startsAt });
    const reader = await createUser();
    expect((await call("GET", "/api/helpdesk/schedule", reader)).json().windows).toEqual([later]);
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM audit_log WHERE entity_type = 'helpdesk_schedule'`,
    );
    expect(rows[0].n).toBe(2);
    const clear = await call("PUT", "/api/helpdesk/schedule", m, { windows: [] });
    expect(clear.json()).toMatchObject({ configured: false, open: true, nextChangeAt: null });
  });

  it("treats touching windows as one continuous opening and keeps same-key retries", async () => {
    const m = await createUserWithCapabilities(manageCaps);
    const put = await call("PUT", "/api/helpdesk/schedule", m, {
      windows: [win(-1, 1), win(1, 3)],
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().nextChangeAt).toBe(put.json().windows[1].endsAt);
    const repeat = await call("PUT", "/api/helpdesk/schedule", m, {
      windows: put.json().windows,
    });
    expect(repeat.statusCode).toBe(200);
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM audit_log WHERE entity_type = 'helpdesk_schedule'`,
    );
    expect(rows[0].n).toBe(1);
  });

  it("requires helpdesk:manage to write", async () => {
    const p = await createUserWithCapabilities(participantCaps);
    const res = await call("PUT", "/api/helpdesk/schedule", p, { windows: [win(1, 2)] });
    expect(res.statusCode).toBe(403);
    expect((await call("GET", "/api/helpdesk/schedule", p)).json().configured).toBe(false);
  });

  it("rejects reversed, overlapping and too many windows", async () => {
    const m = await createUserWithCapabilities(manageCaps);
    const reversed = await call("PUT", "/api/helpdesk/schedule", m, {
      windows: [{ startsAt: win(2, 3).endsAt, endsAt: win(2, 3).startsAt }],
    });
    expect(reversed.statusCode).toBe(400);
    const overlap = await call("PUT", "/api/helpdesk/schedule", m, {
      windows: [win(1, 3), win(2, 4)],
    });
    expect(overlap.statusCode).toBe(400);
    const many = await call("PUT", "/api/helpdesk/schedule", m, {
      windows: Array.from({ length: 31 }, (_, i) => win(i * 2, i * 2 + 1)),
    });
    expect(many.statusCode).toBe(400);
    expect((await call("GET", "/api/helpdesk/schedule", m)).json().configured).toBe(false);
  });

  it("refuses new requests while closed, with the original reply kept for retries", async () => {
    const m = await createUserWithCapabilities(manageCaps);
    const p = await createUserWithCapabilities(participantCaps);
    await admitParticipant(p);
    const idem = key();
    const send = (extra: Record<string, string> = {}) =>
      app.inject({
        method: "POST",
        url: "/api/helpdesk/requests",
        headers: { ...asUser(p), "idempotency-key": idem, ...extra },
        payload: body,
      });
    const created = await send();
    expect(created.statusCode).toBe(201);
    await call("PUT", "/api/helpdesk/schedule", m, { windows: [win(3, 4)] });
    const replay = await send();
    expect(replay.statusCode).toBe(201);
    expect(replay.json().id).toBe(created.json().id);

    const q = await createUserWithCapabilities(participantCaps);
    await admitParticipant(q);
    const refused = await call("POST", "/api/helpdesk/requests", q, body);
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ error: { details: { code: "helpdesk_closed" } } });

    // Everything else keeps working: the existing request can be cancelled.
    const cancel = await call("POST", `/api/helpdesk/requests/${created.json().id}/cancel`, p);
    expect(cancel.statusCode).toBe(200);

    await call("PUT", "/api/helpdesk/schedule", m, { windows: [win(-1, 1)] });
    const open = await call("POST", "/api/helpdesk/requests", q, body);
    expect(open.statusCode).toBe(201);
  });
});

describe("user management edits a person's helper profile", () => {
  it("edits topics and unpublishes as admin, but never publishes for the person", async () => {
    const person = await createUserWithCapabilities(helperCaps);
    const staff = await createUserWithCapabilities([
      CAPABILITIES.USERS_READ,
      CAPABILITIES.USERS_WRITE,
    ]);
    const t = await topic("Kubernetes");
    const own = await call("PUT", "/api/me/helper-profile", person, {
      published: true,
      topicIds: [],
    });
    expect(own.statusCode).toBe(200);

    const edited = await call("PUT", `/api/users/${person}/helper-profile`, staff, {
      published: true,
      topicIds: [t],
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().topics.map((x: { id: number }) => x.id)).toEqual([t]);
    const read = await call("GET", `/api/users/${person}/helper-profile`, staff);
    expect(read.json()).toMatchObject({ eligible: true, published: true });

    const off = await call("PUT", `/api/users/${person}/helper-profile`, staff, {
      published: false,
      topicIds: [t],
    });
    expect(off.json().published).toBe(false);
    const on = await call("PUT", `/api/users/${person}/helper-profile`, staff, {
      published: true,
      topicIds: [t],
    });
    expect(on.statusCode).toBe(403);
    expect(on.json().error.details.code).toBe("helper_publish_own_consent");

    const { rows } = await pool.query(
      `SELECT actor_id, source FROM audit_log WHERE entity_type = 'helper_profile' AND action = 'updated' ORDER BY id DESC LIMIT 1`,
    );
    expect(rows[0]).toMatchObject({ actor_id: staff, source: "admin" });
  });

  it("needs the user-management capabilities", async () => {
    const person = await createUserWithCapabilities(helperCaps);
    const reader = await createUserWithCapabilities([CAPABILITIES.USERS_READ]);
    const plain = await createUser();
    expect((await call("GET", `/api/users/${person}/helper-profile`, reader)).statusCode).toBe(200);
    expect((await call("GET", `/api/users/${person}/helper-profile`, plain)).statusCode).toBe(403);
    expect(
      (
        await call("PUT", `/api/users/${person}/helper-profile`, reader, {
          published: false,
          topicIds: [],
        })
      ).statusCode,
    ).toBe(403);
  });
});

describe("knowledge catalogue management (H61)", () => {
  it("lists usage, renames, merges and deletes only unused topics", async () => {
    const manager = await createUserWithCapabilities([CAPABILITIES.HELPDESK_MANAGE]);
    const helperUser = await createUserWithCapabilities(helperCaps);
    const used = await topic("Rust");
    const dup = await topic("rust lang");
    const spare = await topic("Obsolete");
    await call("PUT", "/api/me/helper-profile", helperUser, { published: false, topicIds: [dup] });

    const list = await call("GET", "/api/helpdesk/topics/manage", manager);
    expect(list.statusCode).toBe(200);
    const byId = new Map(
      list.json().topics.map((t: { id: number; helpers: number }) => [t.id, t.helpers]),
    );
    expect(byId.get(dup)).toBe(1);
    expect(byId.get(spare)).toBe(0);

    expect((await call("DELETE", `/api/helpdesk/topics/${dup}`, manager)).statusCode).toBe(409);
    expect((await call("DELETE", `/api/helpdesk/topics/${spare}`, manager)).statusCode).toBe(204);
    const merge = await call("POST", `/api/helpdesk/topics/${dup}/merge`, manager, {
      targetId: used,
    });
    expect(merge.statusCode).toBe(200);
    const after = await call("GET", "/api/helpdesk/topics/manage", manager);
    expect(after.json().topics.find((t: { id: number }) => t.id === used).helpers).toBe(1);

    const plain = await createUserWithCapabilities(helperCaps);
    expect((await call("GET", "/api/helpdesk/topics/manage", plain)).statusCode).toBe(403);
  });
});

describe("who may request help (H64)", () => {
  it("limits requests to people with event access unless the organizer opens them", async () => {
    const manager = await createUserWithCapabilities([CAPABILITIES.HELPDESK_MANAGE]);
    // helpdesk:request alone, without a role that grants event access.
    const outsider = await createUserWithCapabilities(participantCaps);
    await pool.query(
      "UPDATE roles SET event_access = false WHERE id IN (SELECT role_id FROM user_roles WHERE user_id = $1)",
      [outsider],
    );
    const body = { description: "Help", location: "Here", topicIds: [], other: true };
    const blocked = await call("POST", "/api/helpdesk/requests", outsider, body);
    expect(blocked.statusCode).toBe(403);

    const schedule = await call("GET", "/api/helpdesk/schedule", outsider);
    expect(schedule.json().eventAccessOnly).toBe(true);
    const opened = await call("PUT", "/api/helpdesk/schedule", manager, {
      windows: [],
      eventAccessOnly: false,
    });
    expect(opened.json().eventAccessOnly).toBe(false);
    expect((await call("POST", "/api/helpdesk/requests", outsider, body)).statusCode).toBe(201);

    // Leaving the flag out keeps it; turning it back on closes the door again.
    const kept = await call("PUT", "/api/helpdesk/schedule", manager, { windows: [] });
    expect(kept.json().eventAccessOnly).toBe(false);
    await call("PUT", "/api/helpdesk/schedule", manager, { windows: [], eventAccessOnly: true });
    await pool.query("DELETE FROM help_requests");
    expect((await call("POST", "/api/helpdesk/requests", outsider, body)).statusCode).toBe(403);
  });
});
