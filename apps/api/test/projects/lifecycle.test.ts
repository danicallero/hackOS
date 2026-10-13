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
  assignChallengeToRoom,
  createChallenge,
  createRoom,
  enqueueRepo,
  getEntry,
} from "../queue/fixtures.js";
import { admitParticipant, setHackingWindow } from "./fixtures.js";

let app: App;
let owner: number;
let admin: number;
beforeEach(async () => {
  await truncateAll();
  await pool.query(
    `UPDATE queue_settings SET schedule_start_at=NULL,schedule_end_at=NULL WHERE id=1`,
  );
  if (!app) app = await buildTestApp();
  owner = await createUser({ email: "alice@school.test" });
  await admitParticipant(owner);
  admin = await createUserWithCapabilities([
    CAPABILITIES.PROJECTS_EDIT,
    CAPABILITIES.QUEUE_ADMIN,
  ]);
  await setHackingWindow(true);
  await pool.query(`UPDATE event_config SET participants_can_create_projects=true WHERE id=1`);
});
afterAll(async () => {
  await app?.close();
  const { stopQueues } = await import("../../src/lib/queues.js");
  const { closeValkey } = await import("../../src/lib/valkey.js");
  await stopQueues();
  await closeValkey();
  await pool.end();
});
async function create(name = "Alpha", userId = owner) {
  const r = await app.inject({
    method: "POST",
    url: "/api/me/projects",
    headers: asUser(userId),
    payload: { name },
  });
  expect(r.statusCode, r.body).toBe(200);
  return r.json().repo.id as number;
}
async function submit(id: number, userId = owner) {
  return app.inject({
    method: "POST",
    url: `/api/me/projects/${id}/submit`,
    headers: asUser(userId),
    payload: {},
  });
}
async function edit(id: number, name: string) {
  return app.inject({
    method: "PATCH",
    url: `/api/me/projects/${id}`,
    headers: asUser(owner),
    payload: { name },
  });
}
async function detail(id: number) {
  return (
    await app.inject({
      method: "GET",
      url: `/api/me/projects/${id}/submission`,
      headers: asUser(owner),
    })
  ).json();
}
async function resolve(id: number, payload: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: `/api/projects/${id}/resolve`,
    headers: asUser(admin),
    payload: { reason: "Organizer decision", ...payload },
  });
}
async function deadline() {
  await pool.query(
    `UPDATE event_config SET hacking_ends_at=now()-interval '1 minute',hacking_starts_at=now()-interval '2 hours' WHERE id=1`,
  );
}

describe("project lifecycle and authorization (H19-H21, H53, #1006)", () => {
  it("creates independent drafts; a participant may hold several", async () => {
    const a = await create();
    const b = await create("Beta");
    expect(a).not.toBe(b);
    expect(await detail(a)).toMatchObject({ status: "draft", submittedAt: null, eligible: false });
    expect((await pool.query(`SELECT count(*)::int n FROM repos`)).rows[0].n).toBe(2);
  });

  it("submits without locking: members keep editing and resubmit; the last snapshot counts", async () => {
    const repo = await create();
    const first = await submit(repo);
    expect(first.statusCode, first.body).toBe(200);
    expect(await detail(repo)).toMatchObject({
      status: "submitted",
      submittedVia: "participant",
      eligible: true,
      lockedAt: null,
      changedSinceSubmit: false,
    });

    expect((await edit(repo, "Improved")).statusCode).toBe(200);
    expect(await detail(repo)).toMatchObject({ status: "submitted", changedSinceSubmit: true });
    expect((await submit(repo)).statusCode).toBe(200);

    const snapshots = await pool.query(
      `SELECT source, snapshot FROM project_submission_versions WHERE repo_id=$1 ORDER BY id`,
      [repo],
    );
    expect(snapshots.rows.map((r) => r.source)).toEqual(["participant", "participant"]);
    expect(snapshots.rows[0].snapshot.project.name).toBe("Alpha");
    expect(snapshots.rows[1].snapshot.project.name).toBe("Improved");
    expect(snapshots.rows[1].snapshot.members).toHaveLength(1);
  });

  it("locks by organizer decision, takes edit requests, and reopens with audited history", async () => {
    const repo = await create();
    expect((await submit(repo)).statusCode).toBe(200);
    expect((await resolve(repo, { eligibilityOverride: true })).statusCode).toBe(200);
    expect(await detail(repo)).toMatchObject({ lockReason: "organizer_lock", eligible: true });

    for (const [method, url, payload] of [
      ["PATCH", `/api/me/projects/${repo}`, { name: "Oops" }],
      ["POST", `/api/me/projects/${repo}/invites`, { email: "other@school.test" }],
      ["POST", `/api/me/projects/${repo}/submit`, {}],
    ] as const) {
      const r = await app.inject({ method, url, headers: asUser(owner), payload });
      expect(r.statusCode).toBe(409);
    }
    const request = await app.inject({
      method: "POST",
      url: `/api/me/projects/${repo}/edit-requests`,
      headers: asUser(owner),
      payload: { reason: "Fix the demo" },
    });
    expect(request.statusCode).toBe(200);
    const selfUnlock = await app.inject({
      method: "POST",
      url: `/api/projects/${repo}/unlock`,
      headers: asUser(owner),
      payload: { reason: "Self unlock", decision: "unlock" },
    });
    expect(selfUnlock.statusCode).toBe(403);
    const denied = await app.inject({
      method: "POST",
      url: `/api/projects/${repo}/unlock`,
      headers: asUser(admin),
      payload: { reason: "Not appropriate", decision: "deny" },
    });
    expect(denied.statusCode).toBe(200);
    expect((await detail(repo)).lockedAt).not.toBeNull();

    // After the deadline only an organizer reopening lets members edit again.
    await deadline();
    const reopen = await app.inject({
      method: "POST",
      url: `/api/projects/${repo}/unlock`,
      headers: asUser(admin),
      payload: { reason: "Late correction allowed", decision: "unlock" },
    });
    expect(reopen.statusCode, reopen.body).toBe(200);
    expect(await detail(repo)).toMatchObject({ status: "draft", lockedAt: null, eligible: false });
    expect((await edit(repo, "Corrected")).statusCode).toBe(200);
    expect((await submit(repo)).statusCode).toBe(200);
    expect(
      (
        await pool.query(`SELECT action FROM audit_log WHERE entity_type='repo' AND entity_id=$1`, [
          String(repo),
        ])
      ).rows.map((r) => r.action),
    ).toEqual(
      expect.arrayContaining(["submit", "resolve_exception", "request_edits", "deny_edits", "unlock"]),
    );
  });

  it("rejects nonmembers and submissions after the deadline", async () => {
    const repo = await create();
    const stranger = await createUser();
    await admitParticipant(stranger);
    expect((await submit(repo, stranger)).statusCode).toBe(403);
    const request = await app.inject({
      method: "POST",
      url: `/api/me/projects/${repo}/edit-requests`,
      headers: asUser(stranger),
      payload: { reason: "Bad" },
    });
    expect(request.statusCode).toBe(403);
    await deadline();
    expect((await submit(repo)).statusCode).toBe(403);
    expect((await detail(repo)).status).toBe("draft");
  });

  it("enforces the team-size rule unless an organizer grants an exception", async () => {
    const bob = await createUser({ email: "bob@school.test" });
    await admitParticipant(bob);
    const repo = await create();
    await pool.query(`INSERT INTO submissions(repo_id,user_id,status) VALUES($1,$2,'active')`, [
      repo,
      bob,
    ]);
    await pool.query(`UPDATE event_config SET project_max_team_size=1 WHERE id=1`);
    expect((await submit(repo)).statusCode).toBe(409);
    expect(await detail(repo)).toMatchObject({ participantCount: 2, teamSizeViolation: true });
    expect((await resolve(repo, { teamSizeException: true })).statusCode).toBe(200);
    expect((await submit(repo)).statusCode).toBe(200);
    expect(await detail(repo)).toMatchObject({ teamSizeViolation: false, eligible: true });
  });
});

describe("judging eligibility follows submission (H21, H38)", () => {
  async function servingRoom() {
    const challengeId = await createChallenge();
    const roomId = await createRoom();
    await assignChallengeToRoom(roomId, challengeId);
    return { challengeId, roomId };
  }
  async function callNext(roomId: number, operator: number) {
    return app.inject({
      method: "POST",
      url: `/api/queue/rooms/${roomId}/call-next`,
      headers: asUser(operator),
      payload: {},
    });
  }

  it("never calls a draft; calls it once submitted unless an organizer excludes it", async () => {
    const operator = await createUserWithCapabilities([CAPABILITIES.QUEUE_OPERATE]);
    const repo = await create();
    const { challengeId, roomId } = await servingRoom();
    const entry = await enqueueRepo(challengeId, repo, 1);

    await callNext(roomId, operator);
    expect(await getEntry(entry)).toMatchObject({ status: "waiting", position: 1 });

    expect((await submit(repo)).statusCode).toBe(200);
    expect((await resolve(repo, { eligibilityOverride: false })).statusCode).toBe(200);
    expect((await detail(repo)).eligible).toBe(false);
    await callNext(roomId, operator);
    expect(await getEntry(entry)).toMatchObject({ status: "waiting", position: 1 });

    expect((await resolve(repo, { eligibilityOverride: null })).statusCode).toBe(200);
    expect((await detail(repo)).eligible).toBe(true);
    expect((await callNext(roomId, operator)).statusCode).toBe(200);
    expect((await getEntry(entry)).status).toBe("called");
  });
});

describe("event project team-size rule (H19/H21/H53)", () => {
  it("saves and resets the rule without a justification while auditing each change", async () => {
    const organizer = await createUserWithCapabilities([
      CAPABILITIES.PROJECTS_EDIT,
      CAPABILITIES.EVENT_MANAGE,
    ]);
    const initial = (await pool.query(`SELECT project_max_team_size FROM event_config WHERE id=1`))
      .rows[0];
    for (const maxTeamSize of [4, null]) {
      const response = await app.inject({
        method: "PATCH",
        url: "/api/projects/submission-rules",
        headers: asUser(organizer),
        payload: { maxTeamSize },
      });
      expect(response.statusCode, response.body).toBe(200);
    }
    const entries = (
      await pool.query(
        `SELECT actor_id,before,after,reason,created_at FROM audit_log WHERE action='project_submission_rules' ORDER BY id`,
      )
    ).rows;
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      actor_id: organizer,
      before: initial,
      after: { project_max_team_size: 4 },
      reason: null,
    });
    expect(entries[1]).toMatchObject({
      actor_id: organizer,
      before: { project_max_team_size: 4 },
      after: { project_max_team_size: null },
      reason: null,
    });
    expect(entries.every((entry) => entry.created_at != null)).toBe(true);
    expect(
      (await pool.query(`SELECT project_max_team_size FROM event_config WHERE id=1`)).rows[0]
        .project_max_team_size,
    ).toBeNull();
  });

  it("requires both project editing and event management", async () => {
    const eventOnly = await createUserWithCapabilities([CAPABILITIES.EVENT_MANAGE]);
    for (const userId of [owner, admin, eventOnly]) {
      const response = await app.inject({
        method: "PATCH",
        url: "/api/projects/submission-rules",
        headers: asUser(userId),
        payload: { maxTeamSize: 4 },
      });
      expect(response.statusCode).toBe(403);
    }
    expect(
      (
        await pool.query(
          `SELECT count(*)::int n FROM audit_log WHERE action='project_submission_rules'`,
        )
      ).rows[0].n,
    ).toBe(0);
  });

  it("rejects invalid limits without changing the rule or its audit", async () => {
    const organizer = await createUserWithCapabilities([
      CAPABILITIES.PROJECTS_EDIT,
      CAPABILITIES.EVENT_MANAGE,
    ]);
    for (const maxTeamSize of [0, -1, 2.5, 101]) {
      const response = await app.inject({
        method: "PATCH",
        url: "/api/projects/submission-rules",
        headers: asUser(organizer),
        payload: { maxTeamSize },
      });
      expect(response.statusCode).toBe(400);
    }
    expect(
      (
        await pool.query(
          `SELECT count(*)::int n FROM audit_log WHERE action='project_submission_rules'`,
        )
      ).rows[0].n,
    ).toBe(0);
  });
});
