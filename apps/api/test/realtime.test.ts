import { get } from "node:http";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS, REALTIME_LIMITS, SSE_TOPICS } from "@hackos/shared/events";
import type { FastifyRequest } from "fastify";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { register } from "../src/lib/metrics.js";
import { authorizeRealtimeScopes } from "../src/lib/realtime.routes.js";
import { broadcast } from "../src/lib/sse.js";
import {
  asUser,
  buildTestApp,
  createRole,
  createUser,
  createUserWithCapabilities,
  truncateAll,
} from "./helpers.js";
import {
  addChallengeJudge,
  createChallenge,
  createRepoWithTeam,
  enqueueRepo,
} from "./queue/fixtures.js";

let app: App;
let address: string;
const streams = new Set<import("node:stream").Readable>();
beforeEach(async () => {
  for (const stream of streams) stream.destroy();
  streams.clear();
  if (app)
    await expect
      .poll(async () => (await register.metrics()).includes('topic="multiplexed"}'))
      .toBe(false);
  await truncateAll();
  if (!app) {
    app = await buildTestApp();
    address = await app.listen({ port: 0, host: "127.0.0.1" });
  }
});
afterAll(async () => {
  for (const stream of streams) stream.destroy();
  await app?.close();
  const { stopQueues } = await import("../src/lib/queues.js");
  const { closeValkey } = await import("../src/lib/valkey.js");
  await stopQueues();
  await closeValkey();
  await pool.end();
});
const url = (scopes: string[]) =>
  `/api/realtime/stream?scopes=${encodeURIComponent(scopes.join(","))}`;
async function open(userId: number, scopes: string[]) {
  const stream = await new Promise<import("node:http").IncomingMessage>((resolve, reject) => {
    const request = get(`${address}${url(scopes)}`, { headers: asUser(userId) }, resolve);
    request.on("error", reject);
  });
  expect(stream.statusCode).toBe(200);
  streams.add(stream);
  let text = "";
  stream.on("data", (chunk) => {
    text += chunk.toString();
  });
  stream.on("error", () => undefined);
  await expect.poll(() => text).toContain(": connected");
  return { stream, text: () => text };
}

describe("multiplexed authorization and wire contract (#892)", () => {
  it("rejects anonymous, arbitrary, privileged and oversized scope requests before opening SSE", async () => {
    const user = await createUser();
    expect((await app.inject({ url: url(["personal"]) })).statusCode).toBe(401);
    for (const scope of [
      "user:2",
      "queue:fixture",
      "review:0",
      "review:2147483648",
      "domain:unknown",
    ]) {
      const response = await app.inject({ url: url([scope]), headers: asUser(user) });
      expect([400, 403, 404]).toContain(response.statusCode);
    }
    for (const scope of [
      "queue",
      "exports",
      "logistics",
      "domain:logistics",
      "domain:audit",
      "domain:tv",
    ]) {
      expect((await app.inject({ url: url([scope]), headers: asUser(user) })).statusCode).toBe(403);
    }
    expect(
      (
        await app.inject({
          url: url(Array(REALTIME_LIMITS.MAX_SCOPES + 1).fill("personal")),
          headers: asUser(user),
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          url: `/api/realtime/stream?scopes=${"a".repeat(2049)}`,
          headers: asUser(user),
        })
      ).statusCode,
    ).toBe(400);
  });

  it("derives personal identity and carries isolated topic envelopes on one physical connection", async () => {
    const user = await createUserWithCapabilities([CAPABILITIES.QUEUE_OPERATE]);
    const other = await createUser();
    const connection = await open(user, ["personal", "queue", "domain:projects"]);
    const metrics = await register.metrics();
    expect(metrics).toMatch(/hackos_sse_local_connections\{lane="P0",topic="multiplexed"\} 1\n/);
    expect(metrics).toMatch(/hackos_sse_local_subscriptions\{topic="user"\} 1\n/);
    await broadcast(`${SSE_TOPICS.USER_PREFIX}${other}`, EVENTS.USER_NOTIFICATION, {
      private: true,
    });
    await broadcast(SSE_TOPICS.QUEUE, EVENTS.QUEUE_ENTRY_CHANGED, { entryId: 123 });
    await broadcast(`${SSE_TOPICS.USER_PREFIX}${user}`, EVENTS.USER_NOTIFICATION, { own: true });
    await expect.poll(connection.text).toContain('"topic":"personal"');
    expect(connection.text()).toContain('"topic":"queue"');
    expect(connection.text()).not.toContain('"private":true');
    expect(connection.text()).not.toContain('"topic":"domain:projects"');
  });

  it("retains entry authorization and stops delivery after relationship removal", async () => {
    const judge = await createUser();
    const outsider = await createUser();
    const challenge = await createChallenge();
    await addChallengeJudge(challenge, judge);
    const { repoId } = await createRepoWithTeam();
    const entry = await enqueueRepo(challenge, repoId, 1);
    expect(
      (await app.inject({ url: url([`review:${entry}`]), headers: asUser(outsider) })).statusCode,
    ).toBe(403);
    const connection = await open(judge, ["personal", `review:${entry}`]);
    await broadcast(`${SSE_TOPICS.QUEUE_REVIEW_PREFIX}${entry}`, EVENTS.QUEUE_REVIEW_CHANGED, {});
    await expect.poll(connection.text).toContain(EVENTS.QUEUE_REVIEW_CHANGED);
    await pool.query("DELETE FROM enterprise_judges WHERE user_id = $1", [judge]);
    await broadcast(`${SSE_TOPICS.QUEUE_REVIEW_PREFIX}${entry}`, EVENTS.QUEUE_REVIEW_CHANGED, {
      revoked: true,
    });
    await expect
      .poll(async () => (await register.metrics()).includes('topic="multiplexed"} 1'))
      .toBe(false);
    expect(connection.text()).not.toContain('"revoked":true');
  });

  it("rejects expired, revoked and mismatched session rows during reauthorization", async () => {
    const user = await createUser();
    const other = await createUser();
    const token = crypto.randomUUID();
    await pool.query(
      "INSERT INTO sessions (user_id, token, expires_at) VALUES ($1, $2, now() + interval '1 day')",
      [user, token],
    );
    const request = { userId: user, sessionToken: token } as FastifyRequest;
    await expect(authorizeRealtimeScopes(request, ["personal"])).resolves.toEqual([
      { scope: "personal", topic: `${SSE_TOPICS.USER_PREFIX}${user}` },
    ]);
    await expect(
      authorizeRealtimeScopes({ ...request, userId: other } as FastifyRequest, ["personal"]),
    ).rejects.toMatchObject({ statusCode: 401 });
    await pool.query(
      "UPDATE sessions SET expires_at = now() - interval '1 second' WHERE token = $1",
      [token],
    );
    await expect(authorizeRealtimeScopes(request, ["personal"])).rejects.toMatchObject({
      statusCode: 401,
    });
    await pool.query("DELETE FROM sessions WHERE token = $1", [token]);
    await expect(authorizeRealtimeScopes(request, ["personal"])).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it("stops operational delivery after capability removal", async () => {
    const user = await createUserWithCapabilities([CAPABILITIES.QUEUE_OPERATE]);
    const connection = await open(user, ["personal", "queue"]);
    await pool.query("DELETE FROM user_roles WHERE user_id = $1", [user]);
    await broadcast(SSE_TOPICS.QUEUE, EVENTS.QUEUE_ENTRY_CHANGED, { revoked: true });
    await expect
      .poll(async () => (await register.metrics()).includes('topic="multiplexed"} 1'))
      .toBe(false);
    expect(connection.text()).not.toContain('"revoked":true');
  });

  it("maps operational fixture scopes to separate topics and rejects entry crossover", async () => {
    const real = await createUserWithCapabilities([
      CAPABILITIES.QUEUE_OPERATE,
      CAPABILITIES.ACCREDIT_SCAN,
    ]);
    const fixture = await createUserWithCapabilities([
      CAPABILITIES.QUEUE_OPERATE,
      CAPABILITIES.ACCREDIT_SCAN,
    ]);
    await pool.query("UPDATE users SET is_test_account = true WHERE id = $1", [fixture]);
    const a = await open(real, ["queue", "logistics"]);
    const b = await open(fixture, ["queue", "logistics"]);
    await broadcast(SSE_TOPICS.QUEUE, EVENTS.QUEUE_ENTRY_CHANGED, { marker: "real" });
    await broadcast(SSE_TOPICS.QUEUE_FIXTURE, EVENTS.QUEUE_ENTRY_CHANGED, { marker: "fixture" });
    await broadcast(`${SSE_TOPICS.LOGISTICS}:fixture`, EVENTS.LOGISTICS_ACCREDITED, {
      marker: "fixture-scan",
    });
    await expect.poll(b.text).toContain("fixture-scan");
    await expect.poll(a.text).toContain('"marker":"real"');
    expect(a.text()).not.toContain('"marker":"fixture');
    expect(b.text()).not.toContain('"marker":"real"');
    const challenge = await createChallenge();
    const { repoId } = await createRepoWithTeam();
    const entry = await enqueueRepo(challenge, repoId, 1);
    expect(
      (await app.inject({ url: url([`review:${entry}`]), headers: asUser(fixture) })).statusCode,
    ).toBe(403);
  });

  it("public scopes remain empty projection invalidations", async () => {
    const user = await createUser();
    const connection = await open(user, ["public-tv", "public-content"]);
    await broadcast(SSE_TOPICS.CONTENT, EVENTS.CONTENT_SCHEDULE_CHANGED, { secret: "staff" });
    await broadcast(SSE_TOPICS.QUEUE, EVENTS.QUEUE_ENTRY_CHANGED, { secret: "queue" });
    await expect.poll(connection.text).toContain('"topic":"public-content"');
    expect(connection.text()).toContain('"topic":"public-tv"');
    expect(connection.text()).not.toContain("secret");
    const envelopes = connection
      .text()
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => JSON.parse(line.slice(6)));
    expect(
      envelopes.every(
        (event) => event.type === EVENTS.DATA_CHANGED && Object.keys(event.data).length === 0,
      ),
    ).toBe(true);
  });
  it("refreshes the removed role holder even after the post-mutation member query loses them", async () => {
    const admin = await createUserWithCapabilities([CAPABILITIES.ADMIN_ALL]);
    await pool.query(
      "UPDATE roles SET position = 2147483647 WHERE id IN (SELECT role_id FROM user_roles WHERE user_id = $1)",
      [admin],
    );
    const member = await createUser();
    const unrelated = await createUser();
    const role = await createRole([], { eventAccess: false });
    await pool.query("INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)", [member, role]);
    const recipient = await open(member, ["personal"]);
    const other = await open(unrelated, ["personal"]);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/api/roles/${role}/users/${member}`,
          headers: asUser(admin),
        })
      ).statusCode,
    ).toBe(200);
    await expect.poll(recipient.text).toContain(EVENTS.USER_SESSION_CHANGED);
    expect(other.text()).not.toContain(EVENTS.USER_SESSION_CHANGED);
  });

  it("keeps profile and removed-project-member session refreshes targeted", async () => {
    const admin = await createUserWithCapabilities([CAPABILITIES.ADMIN_ALL]);
    const member = await createUser();
    const teammate = await createUser();
    const unrelated = await createUser();
    const recipient = await open(member, ["personal"]);
    const other = await open(unrelated, ["personal"]);
    const patch = await app.inject({
      method: "PATCH",
      url: `/api/users/${member}`,
      headers: asUser(admin),
      payload: { language: "es" },
    });
    expect(patch.statusCode).toBe(200);
    await expect.poll(recipient.text).toContain(EVENTS.USER_SESSION_CHANGED);
    const { repoId } = await createRepoWithTeam([member, teammate]);
    const before = recipient.text().split(EVENTS.USER_SESSION_CHANGED).length;
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/api/repos/${repoId}/members/${member}`,
          headers: asUser(admin),
        })
      ).statusCode,
    ).toBe(200);
    await expect
      .poll(() => recipient.text().split(EVENTS.USER_SESSION_CHANGED).length)
      .toBeGreaterThan(before);
    expect(other.text()).not.toContain(EVENTS.USER_SESSION_CHANGED);
  });
});
