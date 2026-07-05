import "./env.js";
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

/** H43-H45: admin-created challenge templates, sponsor ownership, public reveal. */

let app: App;

beforeEach(async () => {
  await truncateAll();
  await pool.query(
    `UPDATE queue_settings SET schedule_start_at = NULL, schedule_end_at = NULL WHERE id = 1`,
  );
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

async function createEnterprise(name = `ent-${crypto.randomUUID()}`): Promise<number> {
  const { rows } = await pool.query(`INSERT INTO enterprises (name) VALUES ($1) RETURNING id`, [
    name,
  ]);
  return rows[0].id;
}

async function createOwnedChallenge(ownerUserId: number, status = "draft"): Promise<number> {
  const enterpriseId = await createEnterprise();
  const sponsor = await pool.query(
    `INSERT INTO sponsors (enterprise_id, user_id) VALUES ($1, $2) RETURNING id`,
    [enterpriseId, ownerUserId],
  );
  const challenge = await pool.query(
    `INSERT INTO challenges (author, title, description, status, visibility)
     VALUES ($1, 'Owned Challenge', 'Draft details', $2, 'hidden') RETURNING id`,
    [sponsor.rows[0].id, status],
  );
  return challenge.rows[0].id;
}

describe("challenge lifecycle (H43-H45)", () => {
  it("lets admins create a hidden draft template bound to an enterprise", async () => {
    const server = await getApp();
    const admin = await createUserWithCapabilities([CAPABILITIES.SPONSORS_MANAGE]);
    const enterpriseId = await createEnterprise("Acme");

    const created = await server.inject({
      method: "POST",
      url: "/api/challenges",
      headers: asUser(admin),
      payload: {
        enterpriseId,
        title: "Acme AI Challenge",
        description: "Build something useful",
        prizes: [{ name: "1000 EUR", link: "https://acme.test/prize" }],
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().status).toBe("draft");
    expect(created.json().visibility).toBe("hidden");

    const publicBefore = await server.inject({ method: "GET", url: "/api/public/challenges" });
    expect(publicBefore.json().items).toHaveLength(0);

    const author = await pool.query(
      `SELECT s.enterprise_id
         FROM challenges c
         JOIN sponsors s ON s.id = c.author
        WHERE c.id = $1`,
      [created.json().id],
    );
    expect(author.rows[0].enterprise_id).toBe(enterpriseId);

    const versions = await pool.query(`SELECT count(*)::int AS n FROM challenge_versions`);
    expect(versions.rows[0].n).toBe(1);
  });

  it("publishes immediately or on schedule to the public challenges route", async () => {
    const server = await getApp();
    const admin = await createUserWithCapabilities([CAPABILITIES.SPONSORS_MANAGE]);
    const enterpriseId = await createEnterprise("PublicCo");
    const created = await server.inject({
      method: "POST",
      url: "/api/challenges",
      headers: asUser(admin),
      payload: { enterpriseId, title: "Public Prize" },
    });
    const challengeId = created.json().id;

    const future = await server.inject({
      method: "POST",
      url: `/api/challenges/${challengeId}/publish`,
      headers: asUser(admin),
      payload: { availableFrom: new Date(Date.now() + 3600_000).toISOString() },
    });
    expect(future.statusCode).toBe(200);
    expect(future.json().status).toBe("published");
    expect(future.json().visibility).toBe("visible");

    const hiddenUntilReveal = await server.inject({
      method: "GET",
      url: "/api/public/challenges",
    });
    expect(hiddenUntilReveal.json().items).toHaveLength(0);

    const now = await server.inject({
      method: "POST",
      url: `/api/challenges/${challengeId}/publish`,
      headers: asUser(admin),
      payload: {},
    });
    expect(now.statusCode).toBe(200);

    const visible = await server.inject({ method: "GET", url: "/api/public/challenges" });
    expect(visible.json().items).toHaveLength(1);
    expect(visible.json().items[0].title).toBe("Public Prize");
    expect(visible.json().items[0].enterprise.name).toBe("PublicCo");
  });

  it("lets linked sponsor reps access/edit without sponsor portal capability before publish", async () => {
    const server = await getApp();
    const owner = await createUser();
    const challengeId = await createOwnedChallenge(owner);

    const mine = await server.inject({
      method: "GET",
      url: "/api/challenges/mine",
      headers: asUser(owner),
    });
    expect(mine.statusCode).toBe(200);
    expect(mine.json().challenges).toHaveLength(1);

    const edit = await server.inject({
      method: "PATCH",
      url: `/api/challenges/${challengeId}`,
      headers: asUser(owner),
      payload: { description: "Sponsor-owned edit" },
    });
    expect(edit.statusCode).toBe(200);
    expect(edit.json().description).toBe("Sponsor-owned edit");
  });

  it("freezes published general fields for sponsors, while admins can still edit", async () => {
    const server = await getApp();
    const owner = await createUser();
    const admin = await createUserWithCapabilities([CAPABILITIES.SPONSORS_MANAGE]);
    const challengeId = await createOwnedChallenge(owner, "published");
    await pool.query(
      `UPDATE challenges SET visibility = 'visible', available_from = NULL WHERE id = $1`,
      [challengeId],
    );

    const sponsorEdit = await server.inject({
      method: "PATCH",
      url: `/api/challenges/${challengeId}`,
      headers: asUser(owner),
      payload: { description: "Too late" },
    });
    expect(sponsorEdit.statusCode).toBe(403);

    const sponsorPanelEdit = await server.inject({
      method: "PATCH",
      url: `/api/challenges/${challengeId}`,
      headers: asUser(owner),
      payload: { judgingPanelCriteria: [] },
    });
    expect(sponsorPanelEdit.statusCode).toBe(200);

    const adminEdit = await server.inject({
      method: "PATCH",
      url: `/api/challenges/${challengeId}`,
      headers: asUser(admin),
      payload: { description: "Admin correction" },
    });
    expect(adminEdit.statusCode).toBe(200);
    expect(adminEdit.json().description).toBe("Admin correction");
  });
});
