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

/** Food-intolerance dictionary CRUD + public read. */

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

const i18n = (t: string) => ({ en: t, es: t, gl: t });

describe("food-intolerance dictionary", () => {
  it("requires INTOLERANCES_MANAGE to create", async () => {
    const a = await getApp();
    const pleb = await createUser();
    const res = await a.inject({
      method: "POST",
      url: "/api/food-intolerances",
      headers: asUser(pleb),
      payload: { label: i18n("Gluten") },
    });
    expect(res.statusCode).toBe(403);
  });

  it("creates, updates, lists publicly and deletes", async () => {
    const a = await getApp();
    const manager = await createUserWithCapabilities([CAPABILITIES.INTOLERANCES_MANAGE]);

    const created = await a.inject({
      method: "POST",
      url: "/api/food-intolerances",
      headers: asUser(manager),
      payload: { label: i18n("Gluten"), description: i18n("Wheat, barley, rye") },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;

    const patched = await a.inject({
      method: "PATCH",
      url: `/api/food-intolerances/${id}`,
      headers: asUser(manager),
      payload: { label: { en: "Gluten-free", es: "Sin gluten", gl: "Sen glute" } },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().label.en).toBe("Gluten-free");

    // Public read — no auth.
    const pub = await a.inject({ method: "GET", url: "/api/public/food-intolerances" });
    expect(pub.statusCode).toBe(200);
    expect(pub.json().intolerances).toHaveLength(1);

    const del = await a.inject({
      method: "DELETE",
      url: `/api/food-intolerances/${id}`,
      headers: asUser(manager),
    });
    expect(del.statusCode).toBe(204);

    const after = await a.inject({ method: "GET", url: "/api/public/food-intolerances" });
    expect(after.json().intolerances).toHaveLength(0);
  });

  it("404s updating a missing entry", async () => {
    const a = await getApp();
    const manager = await createUserWithCapabilities([CAPABILITIES.INTOLERANCES_MANAGE]);
    const res = await a.inject({
      method: "PATCH",
      url: "/api/food-intolerances/9999",
      headers: asUser(manager),
      payload: { label: i18n("Nope") },
    });
    expect(res.statusCode).toBe(404);
  });
});
