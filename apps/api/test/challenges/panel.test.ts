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

/** H44: judging panel builder — edit / preview / lock / versioning + access. */

let app: App;

beforeEach(async () => {
  await truncateAll();
  // queue_settings is a persistent singleton (not truncated); reset the
  // judging window so an earlier test's lock doesn't leak into this one.
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

const i18n = (t: string) => ({ en: t, es: t, gl: t });
const samplePanel = () => [
  { key: "impact", kind: "scale", label: i18n("Impact"), required: true, min: 0, max: 10 },
  { key: "works", kind: "boolean", label: i18n("Works?"), required: false },
];

/** Seed an enterprise + its sponsor rep + a challenge they own. */
async function seedChallenge(ownerUserId: number): Promise<number> {
  const ent = await pool.query(`INSERT INTO enterprises (name) VALUES ($1) RETURNING id`, [
    `ent-${crypto.randomUUID()}`,
  ]);
  const sponsor = await pool.query(
    `INSERT INTO sponsors (enterprise_id, user_id) VALUES ($1, $2) RETURNING id`,
    [ent.rows[0].id, ownerUserId],
  );
  const ch = await pool.query(
    `INSERT INTO challenges (author, title, status) VALUES ($1, 'My Challenge', 'active') RETURNING id`,
    [sponsor.rows[0].id],
  );
  return ch.rows[0].id;
}

async function startJudging(): Promise<void> {
  await pool.query(
    `UPDATE queue_settings SET schedule_start_at = now() - interval '5 minutes' WHERE id = 1`,
  );
}

describe("judging panel builder (H44)", () => {
  it("lets the owning sponsor build and preview the panel, and versions it", async () => {
    const a = await getApp();
    const owner = await createUserWithCapabilities([CAPABILITIES.SPONSOR_PORTAL]);
    const challengeId = await seedChallenge(owner);

    const res = await a.inject({
      method: "PATCH",
      url: `/api/challenges/${challengeId}`,
      headers: asUser(owner),
      payload: { judgingPanelCriteria: samplePanel() },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().judging_panel_criteria).toHaveLength(2);

    const preview = await a.inject({
      method: "GET",
      url: `/api/challenges/${challengeId}/panel/preview`,
      headers: asUser(owner),
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().locked).toBe(false);
    expect(preview.json().questions).toHaveLength(2);

    // Second edit → a second version snapshot.
    await a.inject({
      method: "PATCH",
      url: `/api/challenges/${challengeId}`,
      headers: asUser(owner),
      payload: { description: "Updated" },
    });
    const versions = await a.inject({
      method: "GET",
      url: `/api/challenges/${challengeId}/versions`,
      headers: asUser(owner),
    });
    expect(versions.json().versions).toHaveLength(2);
  });

  it("lets an org admin edit any challenge", async () => {
    const a = await getApp();
    const owner = await createUser();
    const admin = await createUserWithCapabilities([CAPABILITIES.QUEUE_ADMIN]);
    const challengeId = await seedChallenge(owner);
    const res = await a.inject({
      method: "PATCH",
      url: `/api/challenges/${challengeId}`,
      headers: asUser(admin),
      payload: { judgingPanelCriteria: samplePanel() },
    });
    expect(res.statusCode).toBe(200);
  });

  it("denies a sponsor from another enterprise", async () => {
    const a = await getApp();
    const owner = await createUser();
    const challengeId = await seedChallenge(owner);
    const stranger = await createUserWithCapabilities([CAPABILITIES.SPONSOR_PORTAL]);
    // stranger is a sponsor, but of a different enterprise
    const otherEnt = await pool.query(`INSERT INTO enterprises (name) VALUES ($1) RETURNING id`, [
      `other-${crypto.randomUUID()}`,
    ]);
    await pool.query(`INSERT INTO sponsors (enterprise_id, user_id) VALUES ($1, $2)`, [
      otherEnt.rows[0].id,
      stranger,
    ]);
    const res = await a.inject({
      method: "PATCH",
      url: `/api/challenges/${challengeId}`,
      headers: asUser(stranger),
      payload: { judgingPanelCriteria: samplePanel() },
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects a malformed panel (scale max <= min)", async () => {
    const a = await getApp();
    const admin = await createUserWithCapabilities([CAPABILITIES.QUEUE_ADMIN]);
    const owner = await createUser();
    const challengeId = await seedChallenge(owner);
    const res = await a.inject({
      method: "PATCH",
      url: `/api/challenges/${challengeId}`,
      headers: asUser(admin),
      payload: {
        judgingPanelCriteria: [{ key: "x", kind: "scale", label: i18n("X"), min: 5, max: 5 }],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("locks the panel once judging has started, but still allows other edits", async () => {
    const a = await getApp();
    const admin = await createUserWithCapabilities([CAPABILITIES.QUEUE_ADMIN]);
    const owner = await createUser();
    const challengeId = await seedChallenge(owner);
    await startJudging();

    const locked = await a.inject({
      method: "PATCH",
      url: `/api/challenges/${challengeId}`,
      headers: asUser(admin),
      payload: { judgingPanelCriteria: samplePanel() },
    });
    expect(locked.statusCode).toBe(409);
    expect(locked.json().error.details.code).toBe("panel_locked");

    const stillFine = await a.inject({
      method: "PATCH",
      url: `/api/challenges/${challengeId}`,
      headers: asUser(admin),
      payload: { description: "Late edit to prose is fine" },
    });
    expect(stillFine.statusCode).toBe(200);

    const preview = await a.inject({
      method: "GET",
      url: `/api/challenges/${challengeId}/panel/preview`,
      headers: asUser(admin),
    });
    expect(preview.json().locked).toBe(true);
  });
});
