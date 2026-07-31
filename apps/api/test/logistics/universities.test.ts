import "./env.js";
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

/** University directory: public search/propose + admin create/rename/delete (H12). */

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

describe("university directory", () => {
  it("requires a signed-in user to propose and attributes a successful proposal", async () => {
    const a = await getApp();
    expect(
      (
        await a.inject({
          method: "POST",
          url: "/api/public/universities/propose",
          payload: { name: "Anonymous University" },
        })
      ).statusCode,
    ).toBe(401);

    const proposer = await createUser();
    const proposed = await a.inject({
      method: "POST",
      url: "/api/public/universities/propose",
      headers: asUser(proposer),
      payload: { name: "Proposer University" },
    });
    expect(proposed.statusCode).toBe(201);
    expect(proposed.json().proposed_by).toBe(proposer);
  });

  it("requires INTOLERANCES_MANAGE to create or rename", async () => {
    const a = await getApp();
    const pleb = await createUser();
    const create = await a.inject({
      method: "POST",
      url: "/api/universities",
      headers: asUser(pleb),
      payload: { name: "USC" },
    });
    expect(create.statusCode).toBe(403);
  });

  it("creates, renames, lists and deletes", async () => {
    const a = await getApp();
    const manager = await createUserWithCapabilities([CAPABILITIES.INTOLERANCES_MANAGE]);

    const created = await a.inject({
      method: "POST",
      url: "/api/universities",
      headers: asUser(manager),
      payload: { name: "Universidade de Santiago" },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as number;

    const renamed = await a.inject({
      method: "PATCH",
      url: `/api/universities/${id}`,
      headers: asUser(manager),
      payload: { name: "Universidade de Santiago de Compostela" },
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().name).toBe("Universidade de Santiago de Compostela");

    // Public search reflects the new name.
    const list = await a.inject({ method: "GET", url: "/api/public/universities?q=Compostela" });
    expect(list.statusCode).toBe(200);
    expect(list.json().universities).toHaveLength(1);

    const del = await a.inject({
      method: "DELETE",
      url: `/api/universities/${id}`,
      headers: asUser(manager),
    });
    expect(del.statusCode).toBe(204);
  });

  it("accepts the administrator wildcard for university management", async () => {
    const a = await getApp();
    const admin = await createUserWithCapabilities([CAPABILITIES.ADMIN_ALL]);
    const res = await a.inject({
      method: "POST",
      url: "/api/universities",
      headers: asUser(admin),
      payload: { name: "Wildcard University" },
    });
    expect(res.statusCode).toBe(201);
  });

  it("rejects renaming to an existing name (unique) with 409", async () => {
    const a = await getApp();
    const manager = await createUserWithCapabilities([CAPABILITIES.INTOLERANCES_MANAGE]);
    const headers = asUser(manager);

    await a.inject({
      method: "POST",
      url: "/api/universities",
      headers,
      payload: { name: "A Uni" },
    });
    const second = await a.inject({
      method: "POST",
      url: "/api/universities",
      headers,
      payload: { name: "B Uni" },
    });
    const secondId = second.json().id as number;

    const clash = await a.inject({
      method: "PATCH",
      url: `/api/universities/${secondId}`,
      headers,
      payload: { name: "A Uni" },
    });
    expect(clash.statusCode).toBe(409);
  });

  it("404s when renaming a missing university", async () => {
    const a = await getApp();
    const manager = await createUserWithCapabilities([CAPABILITIES.INTOLERANCES_MANAGE]);
    const res = await a.inject({
      method: "PATCH",
      url: "/api/universities/999999",
      headers: asUser(manager),
      payload: { name: "Ghost Uni" },
    });
    expect(res.statusCode).toBe(404);
  });
});
