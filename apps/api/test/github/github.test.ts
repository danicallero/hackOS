import "./env.js";
import { createHmac } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { pool } from "../../src/db/pool.js";
import { asUser, buildTestApp, createUser, truncateAll } from "../helpers.js";

/** GitHub App repo linking and the activity ranking. */

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

async function project(name: string, memberId?: number): Promise<number> {
  const { rows } = await pool.query(`INSERT INTO repos (name) VALUES ($1) RETURNING id`, [name]);
  if (memberId)
    await pool.query(
      `INSERT INTO submissions (repo_id, user_id, status) VALUES ($1, $2, 'active')`,
      [rows[0].id, memberId],
    );
  return rows[0].id;
}

async function link(repoId: number, githubRepoId: number) {
  await pool.query(
    `INSERT INTO github_repo_links (repo_id, installation_id, github_repo_id, full_name) VALUES ($1, 9, $2, $3)`,
    [repoId, githubRepoId, `org/repo-${githubRepoId}`],
  );
}

const sign = (body: string) => `sha256=${createHmac("sha256", "whsec").update(body).digest("hex")}`;

async function webhook(server: App, event: string, payload: unknown, signature?: string) {
  const body = JSON.stringify(payload);
  return server.inject({
    method: "POST",
    url: "/api/github/webhook",
    headers: {
      "content-type": "application/json",
      "x-github-event": event,
      "x-hub-signature-256": signature ?? sign(body),
    },
    payload: body,
  });
}

describe("project GitHub link", () => {
  it("is only readable by active members", async () => {
    const server = await getApp();
    const member = await createUser();
    const stranger = await createUser();
    const repoId = await project("Team", member);
    const ok = await server.inject({
      method: "GET",
      url: `/api/me/projects/${repoId}/github`,
      headers: asUser(member),
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ configured: true, link: null });
    const denied = await server.inject({
      method: "GET",
      url: `/api/me/projects/${repoId}/github`,
      headers: asUser(stranger),
    });
    expect(denied.statusCode).toBe(403);
  });

  it("returns a GitHub App install URL bound to the member", async () => {
    const server = await getApp();
    const member = await createUser();
    const repoId = await project("Team", member);
    const res = await server.inject({
      method: "POST",
      url: `/api/me/projects/${repoId}/github/install`,
      headers: { ...asUser(member), "idempotency-key": crypto.randomUUID() },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().url).toContain(
      "https://github.com/apps/hackos-test/installations/new?state=",
    );
  });

  it("rejects a callback whose state belongs to another user", async () => {
    const server = await getApp();
    const member = await createUser();
    const other = await createUser();
    const repoId = await project("Team", member);
    const { signState } = await import("../../src/modules/github/client.js");
    const res = await server.inject({
      method: "GET",
      url: `/api/github/callback?installation_id=1&code=c&state=${encodeURIComponent(signState(member, repoId))}`,
      headers: asUser(other),
    });
    expect(res.statusCode).toBe(400);
  });

  it("reports an invalid app private key as a clear error, not a 500", async () => {
    const { installationToken } = await import("../../src/modules/github/client.js");
    await expect(installationToken(123)).rejects.toThrow(/private key is invalid/);
  });

  it("unlinks, audits and drops the tracked activity", async () => {
    const server = await getApp();
    const member = await createUser();
    const repoId = await project("Team", member);
    await link(repoId, 100);
    await pool.query(
      `INSERT INTO github_commits (repo_id, sha, author_login, committed_at) VALUES ($1, 'a', 'ada', now())`,
      [repoId],
    );
    const res = await server.inject({
      method: "DELETE",
      url: `/api/me/projects/${repoId}/github`,
      headers: { ...asUser(member), "idempotency-key": crypto.randomUUID() },
    });
    expect(res.statusCode).toBe(200);
    expect((await pool.query(`SELECT 1 FROM github_commits`)).rowCount).toBe(0);
    const { rows } = await pool.query(
      `SELECT action FROM audit_log WHERE entity_type = 'project_github_link'`,
    );
    expect(rows).toEqual([{ action: "unlink" }]);
  });
});

describe("GitHub webhook and ranking", () => {
  it("rejects an invalid signature", async () => {
    const server = await getApp();
    const res = await webhook(server, "push", { repository: { id: 1 }, commits: [] }, "sha256=bad");
    expect(res.statusCode).toBe(401);
  });

  it("records commits idempotently and ignores unlinked repositories", async () => {
    const server = await getApp();
    const repoId = await project("Team A");
    await link(repoId, 100);
    const push = {
      repository: { id: 100 },
      commits: [
        { id: "c1", author: { username: "ada" }, timestamp: new Date().toISOString() },
        { id: "c2", author: { username: "ada" }, timestamp: new Date().toISOString() },
      ],
    };
    expect((await webhook(server, "push", push)).statusCode).toBe(202);
    expect((await webhook(server, "push", push)).statusCode).toBe(202);
    expect((await webhook(server, "push", { ...push, repository: { id: 999 } })).statusCode).toBe(
      202,
    );
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM github_commits`);
    expect(rows[0].n).toBe(2);
  });

  it("ranks people and teams inside the hacking window only", async () => {
    const server = await getApp();
    await pool.query(
      `INSERT INTO event_config (id, hacking_starts_at, hacking_ends_at)
       VALUES (1, now() - interval '1 day', now() + interval '1 day')
       ON CONFLICT (id) DO UPDATE SET hacking_starts_at = EXCLUDED.hacking_starts_at,
         hacking_ends_at = EXCLUDED.hacking_ends_at`,
    );
    const a = await project("Team A");
    const b = await project("Team B");
    await link(a, 100);
    await link(b, 200);
    const at = new Date().toISOString();
    const before = new Date(Date.now() - 3 * 86_400_000).toISOString();
    await webhook(server, "push", {
      repository: { id: 100 },
      commits: [
        { id: "1", author: { username: "ada" }, timestamp: at },
        { id: "2", author: { username: "ada" }, timestamp: at },
        { id: "old", author: { username: "ada" }, timestamp: before },
      ],
    });
    await webhook(server, "push", {
      repository: { id: 200 },
      commits: [{ id: "3", author: { username: "bob" }, timestamp: at }],
    });
    await webhook(server, "pull_request", {
      repository: { id: 200 },
      pull_request: {
        number: 1,
        state: "closed",
        user: { login: "bob" },
        created_at: at,
        merged_at: at,
      },
    });
    const res = await server.inject({ method: "GET", url: "/api/tv/github" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.commits.people).toEqual([
      { name: "ada", count: 2 },
      { name: "bob", count: 1 },
    ]);
    expect(body.commits.teams[0]).toEqual({ name: "Team A", count: 2 });
    expect(body.pullRequests.teams).toEqual([{ name: "Team B", count: 1, merged: 1 }]);
  });
});

describe("account link", () => {
  it("shows the linked status and unlinks with audit", async () => {
    const server = await getApp();
    const userId = await createUser();
    await pool.query(
      `INSERT INTO github_accounts (user_id, github_id, login) VALUES ($1, 7, 'ada')`,
      [userId],
    );
    const status = await server.inject({
      method: "GET",
      url: "/api/me/github",
      headers: asUser(userId),
    });
    expect(status.json()).toEqual({ configured: true, login: "ada" });
    const res = await server.inject({
      method: "DELETE",
      url: "/api/me/github",
      headers: { ...asUser(userId), "idempotency-key": crypto.randomUUID() },
    });
    expect(res.statusCode).toBe(200);
    const { rows } = await pool.query(
      `SELECT action FROM audit_log WHERE entity_type = 'github_account'`,
    );
    expect(rows).toEqual([{ action: "unlink" }]);
  });

  it("ranks a linked login under the member's name", async () => {
    const server = await getApp();
    const userId = await createUser({ name: "Ada" });
    await pool.query(`UPDATE users SET surname = 'Lovelace' WHERE id = $1`, [userId]);
    await pool.query(
      `INSERT INTO github_accounts (user_id, github_id, login) VALUES ($1, 7, 'ada')`,
      [userId],
    );
    const repoId = await project("Team A");
    await link(repoId, 100);
    await webhook(server, "push", {
      repository: { id: 100 },
      commits: [
        { id: "1", author: { username: "Ada" }, timestamp: new Date().toISOString() },
        { id: "2", author: { username: "grace" }, timestamp: new Date().toISOString() },
      ],
    });
    const body = (await server.inject({ method: "GET", url: "/api/tv/github" })).json();
    expect(body.commits.people.map((row: { name: string }) => row.name).sort()).toEqual([
      "Ada Lovelace",
      "grace",
    ]);
  });
});
