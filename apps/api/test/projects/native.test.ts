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
import { createChallenge } from "./fixtures.js";

/**
 * Native project lifecycle (H18-H20): org-side creation + metadata edits,
 * policy-gated participant self-creation, and the participant self-view.
 */

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

async function enableSelfCreation(): Promise<void> {
  const { pool } = await import("../../src/db/pool.js");
  await pool.query(
    `INSERT INTO event_config (id, participants_can_create_projects) VALUES (1, true)
     ON CONFLICT (id) DO UPDATE SET participants_can_create_projects = true`,
  );
  // Direct SQL bypasses the API, so the GET read cache must be dropped by
  // hand (a real PUT /api/event invalidates it via the onResponse hook).
  const { invalidateReadCache } = await import("../../src/lib/read-cache.js");
  await invalidateReadCache();
}

async function makeVisible(challengeId: number): Promise<void> {
  const { pool } = await import("../../src/db/pool.js");
  await pool.query(`UPDATE challenges SET visibility = 'visible' WHERE id = $1`, [challengeId]);
}

describe("POST /api/repos (H18 native creation)", () => {
  it("creates a repo with members and enqueues chosen challenges at the bottom", async () => {
    const server = await getApp();
    const { pool } = await import("../../src/db/pool.js");
    const editor = await createUserWithCapabilities([CAPABILITIES.PROJECTS_EDIT]);
    const member = await createUser();
    const challengeId = await createChallenge("AI Challenge", []);

    const first = await server.inject({
      method: "POST",
      url: "/api/repos",
      headers: asUser(editor),
      payload: {
        name: "Handmade Rocket",
        description: "Built inside hackOS",
        githubUrl: "https://github.com/x/rocket",
        memberUserIds: [member],
        challengeIds: [challengeId],
      },
    });
    expect(first.statusCode).toBe(200);
    const created = first.json();
    expect(created.repo.name).toBe("Handmade Rocket");
    expect(created.repo.source).toBe("native");
    expect(created.challenges).toHaveLength(1);
    expect(created.challenges[0]).toMatchObject({ challengeId, position: 1 });

    // A second native team on the same challenge lands BELOW the first.
    const second = await server.inject({
      method: "POST",
      url: "/api/repos",
      headers: asUser(editor),
      payload: { name: "Second Team", challengeIds: [challengeId] },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().challenges[0].position).toBe(2);

    // Roster + queue membership visible through the normal read view.
    const read = await server.inject({
      method: "GET",
      url: `/api/repos/${created.repo.id}`,
      headers: asUser(editor),
    });
    // PROJECTS_EDIT alone can't read; use an admin reader instead.
    expect(read.statusCode).toBe(403);
    const reader = await createUserWithCapabilities([CAPABILITIES.PROJECTS_READ]);
    const readOk = await server.inject({
      method: "GET",
      url: `/api/repos/${created.repo.id}`,
      headers: asUser(reader),
    });
    expect(readOk.statusCode).toBe(200);
    const repo = readOk.json();
    expect(repo.members.map((m: { userId: number }) => m.userId)).toContain(member);
    expect(repo.challenges).toHaveLength(1);
    expect(repo.challenges[0]).toMatchObject({ id: challengeId, status: "waiting" });

    // Audited: repo create + queue enqueue in the same transaction (H53).
    const audits = await pool.query(
      `SELECT entity_type, action FROM audit_log WHERE entity_type IN ('repo', 'queue_entry')`,
    );
    expect(audits.rows).toEqual(
      expect.arrayContaining([
        { entity_type: "repo", action: "create" },
        { entity_type: "queue_entry", action: "add_challenge" },
      ]),
    );
  });

  it("is idempotent under the same Idempotency-Key", async () => {
    const server = await getApp();
    const { pool } = await import("../../src/db/pool.js");
    const editor = await createUserWithCapabilities([CAPABILITIES.PROJECTS_EDIT]);
    const payload = { name: "Once Only" };
    const key = crypto.randomUUID();

    const a = await server.inject({
      method: "POST",
      url: "/api/repos",
      headers: { ...asUser(editor), "idempotency-key": key },
      payload,
    });
    const b = await server.inject({
      method: "POST",
      url: "/api/repos",
      headers: { ...asUser(editor), "idempotency-key": key },
      payload,
    });
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(b.headers["idempotency-replayed"]).toBe("true");
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM repos`);
    expect(rows[0].n).toBe(1);
  });

  it("rejects unknown members/challenges and missing capability", async () => {
    const server = await getApp();
    const editor = await createUserWithCapabilities([CAPABILITIES.PROJECTS_EDIT]);
    const nobody = await createUser();

    const badMember = await server.inject({
      method: "POST",
      url: "/api/repos",
      headers: asUser(editor),
      payload: { name: "X", memberUserIds: [999999] },
    });
    expect(badMember.statusCode).toBe(404);

    const badChallenge = await server.inject({
      method: "POST",
      url: "/api/repos",
      headers: asUser(editor),
      payload: { name: "X", challengeIds: [999999] },
    });
    expect(badChallenge.statusCode).toBe(404);

    const forbidden = await server.inject({
      method: "POST",
      url: "/api/repos",
      headers: asUser(nobody),
      payload: { name: "X" },
    });
    expect(forbidden.statusCode).toBe(403);
  });
});

describe("PATCH /api/repos/:id (H18 metadata edit)", () => {
  it("updates only the provided fields and audits before/after", async () => {
    const server = await getApp();
    const { pool } = await import("../../src/db/pool.js");
    const editor = await createUserWithCapabilities([CAPABILITIES.PROJECTS_EDIT]);
    const created = await server.inject({
      method: "POST",
      url: "/api/repos",
      headers: asUser(editor),
      payload: { name: "Before", description: "Keep me", demoUrl: "https://demo.test" },
    });
    const repoId = created.json().repo.id;

    const patched = await server.inject({
      method: "PATCH",
      url: `/api/repos/${repoId}`,
      headers: asUser(editor),
      payload: { name: "After", demoUrl: null },
    });
    expect(patched.statusCode).toBe(200);
    const repo = patched.json();
    expect(repo.name).toBe("After");
    expect(repo.description).toBe("Keep me");
    expect(repo.demo_url).toBeNull();

    const audit = await pool.query(
      `SELECT before, after FROM audit_log WHERE entity_type = 'repo' AND action = 'update'`,
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].before.name).toBe("Before");
    expect(audit.rows[0].after.name).toBe("After");

    const missing = await server.inject({
      method: "PATCH",
      url: "/api/repos/999999",
      headers: asUser(editor),
      payload: { name: "Ghost" },
    });
    expect(missing.statusCode).toBe(404);
  });
});

describe("POST /api/me/projects (H19 policy-gated self-creation)", () => {
  it("403s while the event policy is disabled", async () => {
    const server = await getApp();
    const participant = await createUser();
    const res = await server.inject({
      method: "POST",
      url: "/api/me/projects",
      headers: asUser(participant),
      payload: { name: "My Project" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("creates the caller's project with them as sole member and enqueues visible challenges", async () => {
    const server = await getApp();
    await enableSelfCreation();
    const participant = await createUser();
    const challengeId = await createChallenge("Open Challenge", []);
    await makeVisible(challengeId);

    const res = await server.inject({
      method: "POST",
      url: "/api/me/projects",
      headers: asUser(participant),
      payload: { name: "My Project", description: "Mine", challengeIds: [challengeId] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.repo.source).toBe("native");
    expect(body.challenges).toEqual([expect.objectContaining({ challengeId, position: 1 })]);

    // H20 self-view: team + challenges, and canCreate flips off.
    const mine = await server.inject({
      method: "GET",
      url: "/api/me/projects",
      headers: asUser(participant),
    });
    expect(mine.statusCode).toBe(200);
    const view = mine.json();
    expect(view.canCreate).toBe(false);
    expect(view.projects).toHaveLength(1);
    expect(view.projects[0].members.map((m: { userId: number }) => m.userId)).toEqual([
      participant,
    ]);
    expect(view.projects[0].challenges[0]).toMatchObject({ id: challengeId, status: "waiting" });
  });

  it("409s when the caller already belongs to a project, also under concurrency", async () => {
    const server = await getApp();
    await enableSelfCreation();
    const participant = await createUser();

    const [a, b] = await Promise.all([
      server.inject({
        method: "POST",
        url: "/api/me/projects",
        headers: asUser(participant),
        payload: { name: "Race A" },
      }),
      server.inject({
        method: "POST",
        url: "/api/me/projects",
        headers: asUser(participant),
        payload: { name: "Race B" },
      }),
    ]);
    // Exactly one winner (plan/07 §2): the other request sees the membership.
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);

    const again = await server.inject({
      method: "POST",
      url: "/api/me/projects",
      headers: asUser(participant),
      payload: { name: "Another" },
    });
    expect(again.statusCode).toBe(409);
  });

  it("hides unpublished challenges from self-creation (404, no existence leak)", async () => {
    const server = await getApp();
    await enableSelfCreation();
    const participant = await createUser();
    const hidden = await createChallenge("Hidden Challenge", []);

    const res = await server.inject({
      method: "POST",
      url: "/api/me/projects",
      headers: asUser(participant),
      payload: { name: "Sneaky", challengeIds: [hidden] },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("GET /api/me/projects canCreate (H19/H20)", () => {
  it("reflects the policy for members-less users and stays false when disabled", async () => {
    const server = await getApp();
    const participant = await createUser();

    const off = await server.inject({
      method: "GET",
      url: "/api/me/projects",
      headers: asUser(participant),
    });
    expect(off.json()).toMatchObject({ projects: [], canCreate: false });

    await enableSelfCreation();
    const on = await server.inject({
      method: "GET",
      url: "/api/me/projects",
      headers: asUser(participant),
    });
    expect(on.json()).toMatchObject({ projects: [], canCreate: true });
  });
});
