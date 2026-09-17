import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import {
  asUser,
  buildTestApp,
  createUser,
  createUserWithCapabilities,
  truncateAll,
} from "./helpers.js";

/** H8/#714: one capability snapshot per request, including contextual routes. */

let app: App;

beforeEach(async () => {
  await truncateAll();
  const { valkey } = await import("../src/lib/valkey.js");
  await valkey.flushdb();
});

afterAll(async () => {
  await app?.close();
  const { stopQueues } = await import("../src/lib/queues.js");
  const { closeValkey } = await import("../src/lib/valkey.js");
  await stopQueues();
  await closeValkey();
  await pool.end();
});

async function getApp(): Promise<App> {
  if (!app) app = await buildTestApp();
  return app;
}

async function capabilityQueryCount<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; count: number }> {
  let count = 0;
  const originalQuery = pool.query.bind(pool) as (...args: unknown[]) => Promise<unknown>;
  const querySpy = vi.spyOn(pool, "query").mockImplementation(((
    text: unknown,
    values?: unknown,
  ) => {
    if (typeof text === "string" && text.includes("user_effective_capabilities")) count += 1;
    return originalQuery(text, values);
  }) as typeof pool.query);
  try {
    return { result: await fn(), count };
  } finally {
    querySpy.mockRestore();
  }
}

async function seedChallenge(ownerId: number): Promise<number> {
  const { rows: enterprises } = await pool.query(
    `INSERT INTO enterprises (name) VALUES ($1) RETURNING id`,
    [`context-enterprise-${crypto.randomUUID()}`],
  );
  const { rows: sponsors } = await pool.query(
    `INSERT INTO sponsors (enterprise_id, user_id) VALUES ($1, $2) RETURNING id`,
    [enterprises[0].id, ownerId],
  );
  const { rows: challenges } = await pool.query(
    `INSERT INTO challenges (author, title) VALUES ($1, 'Context challenge') RETURNING id`,
    [sponsors[0].id],
  );
  return challenges[0].id;
}

describe("request-scoped authorization context (#714)", () => {
  it("bounds capability reads to one query in event, sponsor, challenge, notification, queue, and logistics routes", async () => {
    const server = await getApp();

    const eventManager = await createUserWithCapabilities([CAPABILITIES.EVENT_MANAGE]);
    const event = await capabilityQueryCount(() =>
      server.inject({
        method: "PUT",
        url: "/api/event",
        headers: asUser(eventManager),
        payload: { name: "Context event", tagline: "One snapshot" },
      }),
    );
    expect(event.result.statusCode).toBe(200);
    expect(event.count).toBe(1);

    const sponsorAdmin = await createUserWithCapabilities([CAPABILITIES.SPONSORS_MANAGE]);
    const sponsor = await capabilityQueryCount(() =>
      server.inject({ method: "GET", url: "/api/sponsor-faq", headers: asUser(sponsorAdmin) }),
    );
    expect(sponsor.result.statusCode).toBe(200);
    expect(sponsor.count).toBe(1);

    const challengeOwner = await createUser();
    const challengeId = await seedChallenge(challengeOwner);
    const challenge = await capabilityQueryCount(() =>
      server.inject({
        method: "GET",
        url: `/api/challenges/${challengeId}/panel/preview`,
        headers: asUser(challengeOwner),
      }),
    );
    expect(challenge.result.statusCode).toBe(200);
    expect(challenge.count).toBe(1);

    const notificationOperator = await createUserWithCapabilities([CAPABILITIES.QUEUE_OPERATE]);
    const notification = await capabilityQueryCount(() =>
      server.inject({
        method: "PUT",
        url: "/api/me/notification-preferences",
        headers: asUser(notificationOperator),
        payload: {
          preferences: [{ category: "queue.staff", channel: "push", enabled: true }],
        },
      }),
    );
    expect(notification.result.statusCode).toBe(200);
    expect(notification.count).toBe(1);

    const queueAdmin = await createUserWithCapabilities([CAPABILITIES.QUEUE_ADMIN]);
    const queue = await capabilityQueryCount(() =>
      server.inject({ method: "GET", url: "/api/queue/reviews", headers: asUser(queueAdmin) }),
    );
    expect(queue.result.statusCode).toBe(200);
    expect(queue.count).toBe(1);

    const logisticsOperator = await createUserWithCapabilities([CAPABILITIES.ACCREDIT_SCAN]);
    const logistics = await capabilityQueryCount(() =>
      server.inject({
        method: "GET",
        url: "/api/logistics/scan-log",
        headers: asUser(logisticsOperator),
      }),
    );
    expect(logistics.result.statusCode).toBe(200);
    expect(logistics.count).toBe(1);
  });

  it("keeps a request snapshot coherent across concurrent revocation and fails closed for a fresh context", async () => {
    const { createAuthorizationContext, userHasCapability } = await import(
      "../src/lib/capabilities.js"
    );
    const userId = await createUserWithCapabilities([CAPABILITIES.QUEUE_OPERATE]);
    const context = createAuthorizationContext(userId);

    expect(await userHasCapability(context, CAPABILITIES.QUEUE_OPERATE)).toBe(true);

    const role = await pool.query(`SELECT role_id FROM user_roles WHERE user_id = $1`, [userId]);
    const [sameRequest, revocation] = await Promise.all([
      userHasCapability(context, CAPABILITIES.QUEUE_OPERATE),
      pool.query(`DELETE FROM user_roles WHERE user_id = $1 AND role_id = $2`, [
        userId,
        role.rows[0].role_id,
      ]),
    ]);
    await revocation;
    expect(sameRequest).toBe(true);

    expect(
      await userHasCapability(createAuthorizationContext(userId), CAPABILITIES.QUEUE_OPERATE),
    ).toBe(false);

    await pool.query(`UPDATE users SET account_state = 'removal_pending' WHERE id = $1`, [userId]);
    expect(
      await userHasCapability(createAuthorizationContext(userId), CAPABILITIES.QUEUE_OPERATE),
    ).toBe(false);
  });
});
