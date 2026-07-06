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

async function createOwnedChallenge(ownerUserId: number, visibility = "hidden"): Promise<number> {
  const enterpriseId = await createEnterprise();
  const sponsor = await pool.query(
    `INSERT INTO sponsors (enterprise_id, user_id) VALUES ($1, $2) RETURNING id`,
    [enterpriseId, ownerUserId],
  );
  const challenge = await pool.query(
    `INSERT INTO challenges (author, title, description, visibility)
     VALUES ($1, 'Owned Challenge', 'Draft details', $2) RETURNING id`,
    [sponsor.rows[0].id, visibility],
  );
  return challenge.rows[0].id;
}

describe("challenge lifecycle (H43-H45)", () => {
  it("lets admins create a hidden draft template bound to an enterprise", async () => {
    const server = await getApp();
    const admin = await createUserWithCapabilities([CAPABILITIES.SPONSORS_MANAGE]);
    const enterpriseId = await createEnterprise("Acme");
    const revealAt = new Date(Date.now() + 3600_000).toISOString();

    const created = await server.inject({
      method: "POST",
      url: "/api/challenges",
      headers: asUser(admin),
      payload: {
        enterpriseId,
        title: "Acme AI Challenge",
        description: "Build something useful",
        prizes: [{ name: "1000 EUR", link: "https://acme.test/prize" }],
        availableFrom: revealAt,
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().visibility).toBe("hidden");
    expect(created.json().available_from).toBe(revealAt);

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

    const scheduleEdit = await server.inject({
      method: "PATCH",
      url: `/api/challenges/${challengeId}`,
      headers: asUser(owner),
      payload: { availableFrom: new Date(Date.now() + 3600_000).toISOString() },
    });
    expect(scheduleEdit.statusCode).toBe(403);
  });

  it("persists and clears challenge reveal time through the main update route", async () => {
    const server = await getApp();
    const admin = await createUserWithCapabilities([CAPABILITIES.SPONSORS_MANAGE]);
    const challengeId = await createOwnedChallenge(await createUser());
    const revealAt = new Date(Date.now() + 3600_000).toISOString();

    const scheduled = await server.inject({
      method: "PATCH",
      url: `/api/challenges/${challengeId}`,
      headers: asUser(admin),
      payload: { availableFrom: revealAt },
    });
    expect(scheduled.statusCode).toBe(200);
    expect(scheduled.json().available_from).toBe(revealAt);

    const fetched = await server.inject({
      method: "GET",
      url: `/api/challenges/${challengeId}`,
      headers: asUser(admin),
    });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json().available_from).toBe(revealAt);

    const cleared = await server.inject({
      method: "PATCH",
      url: `/api/challenges/${challengeId}`,
      headers: asUser(admin),
      payload: { availableFrom: null },
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().available_from).toBeNull();
  });

  it("freezes visible general fields for sponsors, while admins can still edit", async () => {
    const server = await getApp();
    const owner = await createUser();
    const admin = await createUserWithCapabilities([CAPABILITIES.SPONSORS_MANAGE]);
    const challengeId = await createOwnedChallenge(owner, "visible");

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

  it("bulk-reveals and hides challenges from the list (H45)", async () => {
    const server = await getApp();
    const admin = await createUserWithCapabilities([CAPABILITIES.SPONSORS_MANAGE]);
    const a = await createOwnedChallenge(await createUser());
    const b = await createOwnedChallenge(await createUser());

    const reveal = await server.inject({
      method: "POST",
      url: "/api/challenges/visibility",
      headers: asUser(admin),
      payload: { ids: [a, b], visible: true },
    });
    expect(reveal.statusCode).toBe(200);
    expect(reveal.json().updated).toEqual(expect.arrayContaining([a, b]));

    const publicNow = await server.inject({ method: "GET", url: "/api/public/challenges" });
    expect(publicNow.json().items).toHaveLength(2);

    const hide = await server.inject({
      method: "POST",
      url: "/api/challenges/visibility",
      headers: asUser(admin),
      payload: { ids: [a], visible: false },
    });
    expect(hide.statusCode).toBe(200);

    const publicAfter = await server.inject({ method: "GET", url: "/api/public/challenges" });
    expect(publicAfter.json().items).toHaveLength(1);
  });

  it("stores per-language title/criteria and keeps title synced to English (H44)", async () => {
    const server = await getApp();
    const admin = await createUserWithCapabilities([CAPABILITIES.SPONSORS_MANAGE]);
    const enterpriseId = await createEnterprise("I18nCo");

    const created = await server.inject({
      method: "POST",
      url: "/api/challenges",
      headers: asUser(admin),
      payload: {
        enterpriseId,
        title: "AI Prize",
        titleI18n: { en: "AI Prize", es: "Premio IA", gl: "Premio de IA" },
        descriptionI18n: { en: "Build it", es: "Constrúyelo", gl: "Constrúeo" },
        criteria: "Impact",
        criteriaI18n: { en: "Impact", es: "Impacto", gl: "Impacto gl" },
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().title).toBe("AI Prize");
    expect(created.json().title_i18n).toEqual({
      en: "AI Prize",
      es: "Premio IA",
      gl: "Premio de IA",
    });
    expect(created.json().description).toBe("Build it");
    expect(created.json().description_i18n.es).toBe("Constrúyelo");
    expect(created.json().criteria_i18n.es).toBe("Impacto");
    const id = created.json().id;

    const patched = await server.inject({
      method: "PATCH",
      url: `/api/challenges/${id}`,
      headers: asUser(admin),
      payload: { titleI18n: { en: "New Title", es: "Título nuevo", gl: "Novo título" } },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().title).toBe("New Title");
    expect(patched.json().title_i18n.gl).toBe("Novo título");
  });

  it("hiding clears any pending scheduled reveal (H45)", async () => {
    const server = await getApp();
    const admin = await createUserWithCapabilities([CAPABILITIES.SPONSORS_MANAGE]);
    const enterpriseId = await createEnterprise("SchedCo");
    const created = await server.inject({
      method: "POST",
      url: "/api/challenges",
      headers: asUser(admin),
      payload: { enterpriseId, title: "Scheduled" },
    });
    const id = created.json().id;

    const scheduled = await server.inject({
      method: "POST",
      url: `/api/challenges/${id}/publish`,
      headers: asUser(admin),
      payload: { availableFrom: new Date(Date.now() + 3600_000).toISOString() },
    });
    expect(scheduled.json().visibility).toBe("visible");
    expect(scheduled.json().available_from).not.toBeNull();

    const hidden = await server.inject({
      method: "POST",
      url: `/api/challenges/${id}/unpublish`,
      headers: asUser(admin),
    });
    expect(hidden.json().visibility).toBe("hidden");
    expect(hidden.json().available_from).toBeNull();
  });
});
