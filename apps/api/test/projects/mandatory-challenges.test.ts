import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { asUser, buildTestApp, createUserWithCapabilities, truncateAll } from "../helpers.js";
import { createChallenge, participantsCsv, projectsCsv } from "./fixtures.js";

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
  it("enrolls existing projects once when enabled and prevents a later withdrawal", async () => {
    const server = await getApp();
    const { pool } = await import("../../src/db/pool.js");
    const manager = await createUserWithCapabilities([CAPABILITIES.CHALLENGES_MANAGE]);
    const challengeId = await createChallenge("Required", []);
    const repos = await pool.query(
      `INSERT INTO repos (name) VALUES ('Existing A'), ('Existing B') RETURNING id`,
    );

    const enabled = await server.inject({
      method: "PATCH",
      url: `/api/challenges/${challengeId}`,
      headers: asUser(manager),
      payload: { mandatory: true },
    });
    expect(enabled.statusCode).toBe(200);
    expect(enabled.json().mandatory).toBe(true);

    const entries = await pool.query(
      `SELECT repo_id FROM queue_entries WHERE challenge_id = $1 ORDER BY repo_id`,
      [challengeId],
    );
    expect(entries.rows.map((row: { repo_id: number }) => row.repo_id)).toEqual(
      repos.rows.map((row: { id: number }) => row.id),
    );

    const repeated = await server.inject({
      method: "PATCH",
      url: `/api/challenges/${challengeId}`,
      headers: asUser(manager),
      payload: { mandatory: true },
    });
    expect(repeated.statusCode).toBe(200);
    expect(
      (await pool.query(`SELECT id FROM queue_entries WHERE challenge_id = $1`, [challengeId]))
        .rows,
    ).toHaveLength(2);

    const remove = await server.inject({
      method: "DELETE",
      url: `/api/repos/${repos.rows[0].id}/challenges/${challengeId}`,
      headers: asUser(await createUserWithCapabilities([CAPABILITIES.PROJECTS_EDIT])),
    });
    expect(remove.statusCode).toBe(409);
  });

  it("enrolls every Devpost import and native project without a selected tag", async () => {
    const server = await getApp();
    const { pool } = await import("../../src/db/pool.js");
    const manager = await createUserWithCapabilities([
      CAPABILITIES.CHALLENGES_MANAGE,
      CAPABILITIES.PROJECTS_IMPORT,
      CAPABILITIES.PROJECTS_EDIT,
    ]);
    const challengeId = await createChallenge("Required", []);
    await server.inject({
      method: "PATCH",
      url: `/api/challenges/${challengeId}`,
      headers: asUser(manager),
      payload: { mandatory: true },
    });

    const imported = await server.inject({
      method: "POST",
      url: "/api/devpost/imports/confirm",
      headers: { ...asUser(manager), "idempotency-key": "mandatory-import" },
      payload: { projectsCsv: projectsCsv(), participantsCsv: participantsCsv() },
    });
    expect(imported.statusCode).toBe(200);

    const native = await server.inject({
      method: "POST",
      url: "/api/repos",
      headers: { ...asUser(manager), "idempotency-key": "mandatory-native" },
      payload: { name: "Native mandatory", description: "", memberUserIds: [], challengeIds: [] },
    });
    expect(native.statusCode).toBe(200);

    const entrants = await pool.query(
      `SELECT r.name FROM queue_entries qe JOIN repos r ON r.id = qe.repo_id
        WHERE qe.challenge_id = $1 ORDER BY r.name`,
      [challengeId],
    );
    expect(entrants.rows.map((row: { name: string }) => row.name)).toEqual([
      "Native mandatory",
      "Neural Beans",
      "Rustacean Station",
    ]);
  });
});
