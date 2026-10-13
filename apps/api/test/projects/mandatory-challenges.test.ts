import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { asUser, buildTestApp, createUserWithCapabilities, truncateAll } from "../helpers.js";
import { createChallenge, createProject } from "./fixtures.js";

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

describe("mandatory challenge participation (issue #851)", () => {
  it("enters existing projects once when enabled and prevents a later withdrawal", async () => {
    const server = await getApp();
    const { pool } = await import("../../src/db/pool.js");
    const manager = await createUserWithCapabilities([CAPABILITIES.CHALLENGES_MANAGE]);
    const challengeId = await createChallenge("Required");
    const existingA = await createProject([], { name: "Existing A" });
    const existingB = await createProject([], { name: "Existing B" });

    const enabled = await server.inject({
      method: "PATCH",
      url: `/api/challenges/${challengeId}`,
      headers: asUser(manager),
      payload: { mandatory: true },
    });
    expect(enabled.statusCode).toBe(200);
    expect(enabled.json().mandatory).toBe(true);

    // Before generation, mandatory participation is recorded as each project's selection.
    const entries = await pool.query(
      `SELECT repo_id FROM project_challenges WHERE challenge_id = $1 ORDER BY repo_id`,
      [challengeId],
    );
    expect(entries.rows.map((row: { repo_id: number }) => row.repo_id)).toEqual([
      existingA,
      existingB,
    ]);

    const repeated = await server.inject({
      method: "PATCH",
      url: `/api/challenges/${challengeId}`,
      headers: asUser(manager),
      payload: { mandatory: true },
    });
    expect(repeated.statusCode).toBe(200);
    expect(
      (await pool.query(`SELECT 1 FROM project_challenges WHERE challenge_id = $1`, [challengeId]))
        .rows,
    ).toHaveLength(2);

    const remove = await server.inject({
      method: "DELETE",
      url: `/api/repos/${existingA}/challenges/${challengeId}`,
      headers: asUser(await createUserWithCapabilities([CAPABILITIES.PROJECTS_EDIT])),
    });
    expect(remove.statusCode).toBe(409);
  });

  it("enters every new project and queues them once the queue is generated", async () => {
    const server = await getApp();
    const { pool } = await import("../../src/db/pool.js");
    const manager = await createUserWithCapabilities([
      CAPABILITIES.CHALLENGES_MANAGE,
      CAPABILITIES.PROJECTS_EDIT,
      CAPABILITIES.QUEUE_ADMIN,
    ]);
    const challengeId = await createChallenge("Required");
    await server.inject({
      method: "PATCH",
      url: `/api/challenges/${challengeId}`,
      headers: asUser(manager),
      payload: { mandatory: true },
    });
    await createProject([], { name: "Existing without selection" });

    const created = await server.inject({
      method: "POST",
      url: "/api/repos",
      headers: { ...asUser(manager), "idempotency-key": "mandatory-native" },
      payload: { name: "Created mandatory", description: "", memberUserIds: [], challengeIds: [] },
    });
    expect(created.statusCode).toBe(200);

    const generated = await server.inject({
      method: "POST",
      url: `/api/queue/challenges/${challengeId}/enqueue`,
      headers: { ...asUser(manager), "idempotency-key": "mandatory-generate" },
      payload: {},
    });
    expect(generated.statusCode).toBe(200);

    const entrants = await pool.query(
      `SELECT r.name FROM queue_entries qe JOIN repos r ON r.id = qe.repo_id
        WHERE qe.challenge_id = $1 ORDER BY r.name`,
      [challengeId],
    );
    expect(entrants.rows.map((row: { name: string }) => row.name)).toEqual([
      "Created mandatory",
      "Existing without selection",
    ]);

    // After generation a new project joins the queue immediately.
    const late = await server.inject({
      method: "POST",
      url: "/api/repos",
      headers: { ...asUser(manager), "idempotency-key": "mandatory-late" },
      payload: { name: "Late mandatory", description: "", memberUserIds: [], challengeIds: [] },
    });
    expect(late.json().challenges).toEqual([expect.objectContaining({ challengeId })]);
  });
});
