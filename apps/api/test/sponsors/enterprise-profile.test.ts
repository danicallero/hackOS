import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { describe, expect, it } from "vitest";
import { pool } from "../../src/db/pool.js";
import { asUser, createUser, createUserWithCapabilities, useTestApp } from "../helpers.js";

/** H44/H45/H48/H59: a company's page and the schedule items tied to it. */

const getApp = useTestApp();

async function enterprise(name: string, overrides: { visibility?: string } = {}): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO enterprises (name, visibility, website, description)
     VALUES ($1, $2, 'https://acme.test', 'Makers of things') RETURNING id`,
    [name, overrides.visibility ?? "visible"],
  );
  return rows[0].id;
}

async function member(
  enterpriseId: number,
  name = "Rep",
): Promise<{ userId: number; sponsorId: number }> {
  const userId = await createUser({ name });
  const { rows } = await pool.query(
    `INSERT INTO sponsors (enterprise_id, user_id) VALUES ($1, $2) RETURNING id`,
    [enterpriseId, userId],
  );
  return { userId, sponsorId: rows[0].id };
}

async function item(
  title: string,
  opts: { audiences?: string[]; visibility?: string; hours?: number } = {},
): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO schedule (title, starts_at, ends_at, visibility, audiences)
     VALUES ($1, now() + make_interval(hours => $2), now() + make_interval(hours => $2 + 1), $3, $4::text[])
     RETURNING id`,
    [title, opts.hours ?? 1, opts.visibility ?? "shown", opts.audiences ?? ["participant"]],
  );
  return rows[0].id;
}

async function profile(userId: number, id: number) {
  const a = await getApp();
  return a.inject({
    method: "GET",
    url: `/api/enterprises/${id}/profile`,
    headers: asUser(userId),
  });
}

describe("GET /api/enterprises/:id/profile", () => {
  it("returns details, representatives and only revealed challenges", async () => {
    const acme = await enterprise("Acme");
    const rep = await member(acme, "Ada");
    await member(acme, "Bo");
    await pool.query(
      `INSERT INTO challenges (author, title, description, visibility) VALUES
         ($1, 'Revealed', 'Build a rocket', 'visible'),
         ($1, 'Secret', 'Not yet', 'hidden')`,
      [rep.sponsorId],
    );
    const viewer = await createUser();
    const res = await profile(viewer, acme);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      id: acme,
      name: "Acme",
      website: "https://acme.test",
      description: "Makers of things",
      logoUrl: null,
    });
    expect(body.representatives.map((r: { name: string }) => r.name)).toEqual(["Ada", "Bo"]);
    expect(body.representatives[0].avatarUrl).toBeNull();
    expect(body.challenges).toEqual([
      { id: expect.any(Number), title: "Revealed", summary: "Build a rocket" },
    ]);
  });

  it("lists activities linked directly or through a member speaker, once each, by start", async () => {
    const acme = await enterprise("Acme");
    const other = await enterprise("Other");
    const rep = await member(acme);
    const outsider = await createUser();
    const direct = await item("Direct", { hours: 3 });
    const viaSpeaker = await item("Via speaker", { hours: 1 });
    const both = await item("Both", { hours: 2 });
    const unrelated = await item("Unrelated");
    await pool.query(
      `INSERT INTO schedule_enterprises (schedule_id, enterprise_id) VALUES ($1,$3),($2,$3),($4,$5)`,
      [direct, both, acme, unrelated, other],
    );
    await pool.query(
      `INSERT INTO schedule_speakers (schedule_id, user_id) VALUES ($1,$3),($2,$3),($4,$5)`,
      [viaSpeaker, both, rep.userId, unrelated, outsider],
    );
    const res = await profile(outsider, acme);
    expect(res.json().activities.map((i: { title: string }) => i.title)).toEqual([
      "Via speaker",
      "Both",
      "Direct",
    ]);
    const speaker = res.json().activities[0].speakers[0];
    expect(speaker).toMatchObject({
      userId: rep.userId,
      enterpriseId: acme,
      enterpriseName: "Acme",
    });
  });

  it("follows the schedule audience rules", async () => {
    const acme = await enterprise("Acme");
    const rep = await member(acme);
    const staffOnly = await item("Staff only", { audiences: [], visibility: "hidden" });
    const mentorsOnly = await item("Mentors", { audiences: ["mentor"] });
    const draft = await item("Draft", { visibility: "hidden" });
    const live = await item("Live");
    for (const id of [staffOnly, mentorsOnly, draft, live]) {
      await pool.query(
        `INSERT INTO schedule_enterprises (schedule_id, enterprise_id) VALUES ($1,$2)`,
        [id, acme],
      );
    }
    const viewer = await createUser();
    const asViewer = await profile(viewer, acme);
    expect(asViewer.json().activities.map((i: { title: string }) => i.title)).toEqual(["Live"]);

    const staff = await createUserWithCapabilities([CAPABILITIES.SCHEDULE_READ]);
    const asStaff = await profile(staff, acme);
    expect(asStaff.json().activities).toHaveLength(4);
    expect(rep.userId).toBeGreaterThan(0);
  });

  it("answers 404 for a hidden company unless the caller is staff", async () => {
    const hidden = await enterprise("Stealth", { visibility: "hidden" });
    await pool.query(
      `UPDATE enterprises SET available_from = now() + interval '1 day' WHERE id = $1`,
      [hidden],
    );
    const viewer = await createUser();
    expect((await profile(viewer, hidden)).statusCode).toBe(404);
    expect((await profile(viewer, 999999)).statusCode).toBe(404);
    const staff = await createUserWithCapabilities([CAPABILITIES.SPONSORS_MANAGE]);
    expect((await profile(staff, hidden)).statusCode).toBe(200);
  });

  it("requires a session", async () => {
    const acme = await enterprise("Acme");
    const a = await getApp();
    const res = await a.inject({ method: "GET", url: `/api/enterprises/${acme}/profile` });
    expect(res.statusCode).toBe(401);
  });
});

describe("person profile activities", () => {
  it("lists the shown items a person speaks at and their company", async () => {
    const a = await getApp();
    const acme = await enterprise("Acme");
    const { userId } = await member(acme, "Ada");
    const talk = await item("Talk", { hours: 2 });
    const earlier = await item("Workshop", { hours: 1 });
    const draft = await item("Draft", { visibility: "hidden" });
    await pool.query(
      `INSERT INTO schedule_speakers (schedule_id, user_id) VALUES ($1,$4),($2,$4),($3,$4)`,
      [talk, earlier, draft, userId],
    );
    const staff = await createUserWithCapabilities([CAPABILITIES.USERS_READ]);
    const res = await a.inject({
      method: "GET",
      url: `/api/users/${userId}/public-profile`,
      headers: asUser(staff),
    });
    expect(res.statusCode).toBe(200);
    const card = res.json().preview;
    expect(card.activities.map((i: { title: string }) => i.title)).toEqual(["Workshop", "Talk"]);
    expect(card.activities[0]).toMatchObject({ id: earlier, location: null });
    expect(card.enterprise).toEqual({ id: acme, name: "Acme", logoUrl: null });
  });
});
