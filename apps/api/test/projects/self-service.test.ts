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
import { admitParticipant, setHackingWindow } from "./fixtures.js";

/**
 * H19/H20 self-service on an EXISTING project: edit metadata, invite/accept
 * /decline teammates, leave, delete as the sole remaining member. Every
 * mutation is additionally gated by the hacking window
 * (assertWithinHackingWindow) and, for invites, by "admitted participant"
 * eligibility on the invitee (isAdmittedParticipant) — see service.ts.
 *
 * Projects here are seeded through the staff-side POST /api/repos (H18) so
 * each test controls the hacking window independently of H19's creation
 * policy, which is a separate, unrelated gate from the one under test.
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
  await stopQueues();
  await closeValkey();
  await pool.end();
});

async function getApp(): Promise<App> {
  if (!app) app = await buildTestApp();
  return app;
}

/** Staff-created repo with `memberUserIds` as ACTIVE (default status) members. */
async function seedRepo(name: string, memberUserIds: number[]): Promise<number> {
  const server = await getApp();
  const editor = await createUserWithCapabilities([CAPABILITIES.PROJECTS_EDIT]);
  const res = await server.inject({
    method: "POST",
    url: "/api/repos",
    headers: asUser(editor),
    payload: { name, memberUserIds },
  });
  expect(res.statusCode).toBe(200);
  return res.json().repo.id as number;
}

async function addDevpostMember(repoId: number, userId: number, email: string): Promise<void> {
  await pool.query(
    `INSERT INTO devpost_participants (repo_id, email, user_id, import_batch, merge_status)
     VALUES ($1, $2, $3, 'test', 'auto_matched')`,
    [repoId, email, userId],
  );
}

describe("PATCH /api/me/projects/:id (H19/H20 self-edit)", () => {
  it("lets an active member edit metadata, audited (source: participant)", async () => {
    const server = await getApp();
    const owner = await createUser();
    const repoId = await seedRepo("Before", [owner]);
    await setHackingWindow(true);

    const res = await server.inject({
      method: "PATCH",
      url: `/api/me/projects/${repoId}`,
      headers: asUser(owner),
      payload: { name: "After", description: "Updated by participant" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ name: "After", description: "Updated by participant" });

    const audit = await pool.query(
      `SELECT source FROM audit_log WHERE entity_type = 'repo' AND entity_id = $1 AND action = 'update'`,
      [String(repoId)],
    );
    expect(audit.rows).toEqual([{ source: "participant" }]);
  });

  it("lets a Devpost-matched member edit too", async () => {
    const server = await getApp();
    const owner = await createUser();
    const repoId = await seedRepo("Devpost Team", []);
    await addDevpostMember(repoId, owner, "owner@devpost.test");
    await setHackingWindow(true);

    const res = await server.inject({
      method: "PATCH",
      url: `/api/me/projects/${repoId}`,
      headers: asUser(owner),
      payload: { name: "Renamed" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe("Renamed");
  });

  it("403s for a non-member", async () => {
    const server = await getApp();
    const owner = await createUser();
    const stranger = await createUser();
    const repoId = await seedRepo("Mine", [owner]);
    await setHackingWindow(true);

    const res = await server.inject({
      method: "PATCH",
      url: `/api/me/projects/${repoId}`,
      headers: asUser(stranger),
      payload: { name: "Hijacked" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("403s outside the hacking window", async () => {
    const server = await getApp();
    const owner = await createUser();
    const repoId = await seedRepo("Mine", [owner]);
    await setHackingWindow(false);

    const res = await server.inject({
      method: "PATCH",
      url: `/api/me/projects/${repoId}`,
      headers: asUser(owner),
      payload: { name: "Nope" },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("POST /api/me/projects/:id/invites (H19/H20)", () => {
  it("invites an admitted, account-holding invitee and notifies them", async () => {
    const server = await getApp();
    const owner = await createUser();
    const invitee = await createUser({ email: "invitee@test.local" });
    await admitParticipant(invitee);
    const repoId = await seedRepo("Team", [owner]);
    await setHackingWindow(true);

    const res = await server.inject({
      method: "POST",
      url: `/api/me/projects/${repoId}/invites`,
      headers: asUser(owner),
      payload: { email: "invitee@test.local" },
    });
    expect(res.statusCode).toBe(200);

    const submission = await pool.query(
      `SELECT status, invited_by FROM submissions WHERE repo_id = $1 AND user_id = $2`,
      [repoId, invitee],
    );
    expect(submission.rows[0]).toMatchObject({ status: "invited", invited_by: owner });

    const outbox = await pool.query(`SELECT category FROM notification_outbox WHERE user_id = $1`, [
      invitee,
    ]);
    expect(outbox.rows.length).toBeGreaterThan(0);
    expect(outbox.rows.every((r: { category: string }) => r.category === "project")).toBe(true);

    // Still pending, not yet an active member: doesn't show in myProjects.
    const mine = await server.inject({
      method: "GET",
      url: "/api/me/projects",
      headers: asUser(invitee),
    });
    expect(mine.json().projects).toHaveLength(0);

    const pending = await server.inject({
      method: "GET",
      url: "/api/me/projects/invites",
      headers: asUser(invitee),
    });
    expect(pending.json().invites).toEqual([expect.objectContaining({ repoId, repoName: "Team" })]);
  });

  it("403s when the inviter isn't an active member", async () => {
    const server = await getApp();
    const owner = await createUser();
    const stranger = await createUser();
    const invitee = await createUser({ email: "invitee2@test.local" });
    await admitParticipant(invitee);
    const repoId = await seedRepo("Team", [owner]);
    await setHackingWindow(true);

    const res = await server.inject({
      method: "POST",
      url: `/api/me/projects/${repoId}/invites`,
      headers: asUser(stranger),
      payload: { email: "invitee2@test.local" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("404s when the invitee has no account", async () => {
    const server = await getApp();
    const owner = await createUser();
    const repoId = await seedRepo("Team", [owner]);
    await setHackingWindow(true);

    const res = await server.inject({
      method: "POST",
      url: `/api/me/projects/${repoId}/invites`,
      headers: asUser(owner),
      payload: { email: "ghost@nowhere.test" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("403s when the invitee isn't an admitted participant", async () => {
    const server = await getApp();
    const owner = await createUser();
    await createUser({ email: "unadmitted@test.local" });
    const repoId = await seedRepo("Team", [owner]);
    await setHackingWindow(true);

    const res = await server.inject({
      method: "POST",
      url: `/api/me/projects/${repoId}/invites`,
      headers: asUser(owner),
      payload: { email: "unadmitted@test.local" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("409s when inviting an already-active member of the same project", async () => {
    const server = await getApp();
    const owner = await createUser();
    const teammate = await createUser({ email: "teammate@test.local" });
    await admitParticipant(teammate);
    const repoId = await seedRepo("Team", [owner, teammate]);
    await setHackingWindow(true);

    const res = await server.inject({
      method: "POST",
      url: `/api/me/projects/${repoId}/invites`,
      headers: asUser(owner),
      payload: { email: "teammate@test.local" },
    });
    expect(res.statusCode).toBe(409);
  });

  it("403s outside the hacking window", async () => {
    const server = await getApp();
    const owner = await createUser();
    const invitee = await createUser({ email: "invitee3@test.local" });
    await admitParticipant(invitee);
    const repoId = await seedRepo("Team", [owner]);
    await setHackingWindow(false);

    const res = await server.inject({
      method: "POST",
      url: `/api/me/projects/${repoId}/invites`,
      headers: asUser(owner),
      payload: { email: "invitee3@test.local" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("is idempotent under the same Idempotency-Key", async () => {
    const server = await getApp();
    const owner = await createUser();
    const invitee = await createUser({ email: "invitee4@test.local" });
    await admitParticipant(invitee);
    const repoId = await seedRepo("Team", [owner]);
    await setHackingWindow(true);
    const key = crypto.randomUUID();
    const payload = { email: "invitee4@test.local" };

    const a = await server.inject({
      method: "POST",
      url: `/api/me/projects/${repoId}/invites`,
      headers: { ...asUser(owner), "idempotency-key": key },
      payload,
    });
    const b = await server.inject({
      method: "POST",
      url: `/api/me/projects/${repoId}/invites`,
      headers: { ...asUser(owner), "idempotency-key": key },
      payload,
    });
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(b.headers["idempotency-replayed"]).toBe("true");

    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM submissions WHERE repo_id = $1 AND user_id = $2`,
      [repoId, invitee],
    );
    expect(rows[0].n).toBe(1);
  });
});

describe("POST /api/me/projects/invites/:id/accept|decline (H19/H20)", () => {
  async function invite(): Promise<{ repoId: number; owner: number; invitee: number }> {
    const server = await getApp();
    const owner = await createUser();
    const invitee = await createUser({ email: `inv-${crypto.randomUUID()}@test.local` });
    await admitParticipant(invitee);
    const repoId = await seedRepo("Team", [owner]);
    await setHackingWindow(true);
    const invEmail = (await pool.query(`SELECT email FROM users WHERE id = $1`, [invitee])).rows[0]
      .email;
    const res = await server.inject({
      method: "POST",
      url: `/api/me/projects/${repoId}/invites`,
      headers: asUser(owner),
      payload: { email: invEmail },
    });
    expect(res.statusCode).toBe(200);
    return { repoId, owner, invitee };
  }

  it("lets the invited user accept, becoming an active member visible in myProjects", async () => {
    const server = await getApp();
    const { repoId, invitee } = await invite();

    const res = await server.inject({
      method: "POST",
      url: `/api/me/projects/invites/${repoId}/accept`,
      headers: asUser(invitee),
    });
    expect(res.statusCode).toBe(200);

    const status = await pool.query(
      `SELECT status, responded_at FROM submissions WHERE repo_id = $1 AND user_id = $2`,
      [repoId, invitee],
    );
    expect(status.rows[0].status).toBe("active");
    expect(status.rows[0].responded_at).not.toBeNull();

    const mine = await server.inject({
      method: "GET",
      url: "/api/me/projects",
      headers: asUser(invitee),
    });
    expect(mine.json().projects.map((p: { id: number }) => p.id)).toContain(repoId);
  });

  it("404s when someone other than the invitee tries to accept/decline", async () => {
    const server = await getApp();
    const { repoId, owner } = await invite();

    const acceptAsOwner = await server.inject({
      method: "POST",
      url: `/api/me/projects/invites/${repoId}/accept`,
      headers: asUser(owner),
    });
    expect(acceptAsOwner.statusCode).toBe(404);

    const declineAsOwner = await server.inject({
      method: "POST",
      url: `/api/me/projects/invites/${repoId}/decline`,
      headers: asUser(owner),
    });
    expect(declineAsOwner.statusCode).toBe(404);
  });

  it("lets the invited user decline, removing the invite entirely", async () => {
    const server = await getApp();
    const { repoId, invitee } = await invite();

    const res = await server.inject({
      method: "POST",
      url: `/api/me/projects/invites/${repoId}/decline`,
      headers: asUser(invitee),
    });
    expect(res.statusCode).toBe(200);

    const { rowCount } = await pool.query(
      `SELECT 1 FROM submissions WHERE repo_id = $1 AND user_id = $2`,
      [repoId, invitee],
    );
    expect(rowCount).toBe(0);
  });

  it("403s outside the hacking window", async () => {
    const { repoId, invitee } = await invite();
    await setHackingWindow(false);
    const server = await getApp();

    const res = await server.inject({
      method: "POST",
      url: `/api/me/projects/invites/${repoId}/accept`,
      headers: asUser(invitee),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("DELETE /api/me/projects/:id/leave (H19/H20)", () => {
  it("409s the last remaining member", async () => {
    const server = await getApp();
    const owner = await createUser();
    const repoId = await seedRepo("Solo", [owner]);
    await setHackingWindow(true);

    const res = await server.inject({
      method: "DELETE",
      url: `/api/me/projects/${repoId}/leave`,
      headers: asUser(owner),
    });
    expect(res.statusCode).toBe(409);
  });

  it("lets a non-last member leave; they're no longer counted as a member", async () => {
    const server = await getApp();
    const owner = await createUser();
    const teammate = await createUser();
    const repoId = await seedRepo("Duo", [owner, teammate]);
    await setHackingWindow(true);

    const res = await server.inject({
      method: "DELETE",
      url: `/api/me/projects/${repoId}/leave`,
      headers: asUser(teammate),
    });
    expect(res.statusCode).toBe(200);

    const mine = await server.inject({
      method: "GET",
      url: "/api/me/projects",
      headers: asUser(teammate),
    });
    expect(mine.json().projects).toHaveLength(0);

    const stillOwner = await server.inject({
      method: "GET",
      url: "/api/me/projects",
      headers: asUser(owner),
    });
    expect(
      stillOwner.json().projects[0].members.map((m: { userId: number | null }) => m.userId),
    ).toEqual([owner]);
  });

  it("403s outside the hacking window", async () => {
    const server = await getApp();
    const owner = await createUser();
    const teammate = await createUser();
    const repoId = await seedRepo("Duo", [owner, teammate]);
    await setHackingWindow(false);

    const res = await server.inject({
      method: "DELETE",
      url: `/api/me/projects/${repoId}/leave`,
      headers: asUser(teammate),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("DELETE /api/me/projects/:id (H19/H20 sole-member delete)", () => {
  it("deletes the project when the caller is the sole member", async () => {
    const server = await getApp();
    const owner = await createUser();
    const repoId = await seedRepo("Solo", [owner]);
    await setHackingWindow(true);

    const res = await server.inject({
      method: "DELETE",
      url: `/api/me/projects/${repoId}`,
      headers: asUser(owner),
    });
    expect(res.statusCode).toBe(200);

    const { rowCount } = await pool.query(`SELECT 1 FROM repos WHERE id = $1`, [repoId]);
    expect(rowCount).toBe(0);
  });

  it("409s when there's more than one member", async () => {
    const server = await getApp();
    const owner = await createUser();
    const teammate = await createUser();
    const repoId = await seedRepo("Duo", [owner, teammate]);
    await setHackingWindow(true);

    const res = await server.inject({
      method: "DELETE",
      url: `/api/me/projects/${repoId}`,
      headers: asUser(owner),
    });
    expect(res.statusCode).toBe(409);
  });

  it("403s outside the hacking window", async () => {
    const server = await getApp();
    const owner = await createUser();
    const repoId = await seedRepo("Solo", [owner]);
    await setHackingWindow(false);

    const res = await server.inject({
      method: "DELETE",
      url: `/api/me/projects/${repoId}`,
      headers: asUser(owner),
    });
    expect(res.statusCode).toBe(403);
  });

  it("is idempotent under the same Idempotency-Key", async () => {
    const server = await getApp();
    const owner = await createUser();
    const repoId = await seedRepo("Solo", [owner]);
    await setHackingWindow(true);
    const key = crypto.randomUUID();

    const a = await server.inject({
      method: "DELETE",
      url: `/api/me/projects/${repoId}`,
      headers: { ...asUser(owner), "idempotency-key": key },
    });
    const b = await server.inject({
      method: "DELETE",
      url: `/api/me/projects/${repoId}`,
      headers: { ...asUser(owner), "idempotency-key": key },
    });
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(b.headers["idempotency-replayed"]).toBe("true");
  });
});
