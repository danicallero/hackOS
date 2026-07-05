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

/** H43-H45: enterprise management, owner-limited edits, logo presign, reveal. */

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

async function linkSponsor(userId: number, enterpriseId: number): Promise<void> {
  await pool.query(`INSERT INTO sponsors (enterprise_id, user_id) VALUES ($1, $2)`, [
    enterpriseId,
    userId,
  ]);
}

describe("enterprise management (H43-H45)", () => {
  it("admin creates an enterprise; sponsor rep edits only their profile", async () => {
    const a = await getApp();
    const admin = await createUserWithCapabilities([CAPABILITIES.SPONSORS_MANAGE]);

    const created = await a.inject({
      method: "POST",
      url: "/api/enterprises",
      headers: asUser(admin),
      payload: { name: "Acme", website: "https://acme.test", visibility: "hidden" },
    });
    expect(created.statusCode).toBe(201);
    const entId = created.json().id;

    const owner = await createUser();
    await linkSponsor(owner, entId);

    // Owner may edit description/website/logo…
    const ok = await a.inject({
      method: "PATCH",
      url: `/api/enterprises/${entId}`,
      headers: asUser(owner),
      payload: { description: "We build things", website: "https://acme.example" },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().description).toBe("We build things");

    // …but not org-controlled reveal fields.
    const denied = await a.inject({
      method: "PATCH",
      url: `/api/enterprises/${entId}`,
      headers: asUser(owner),
      payload: { visibility: "visible" },
    });
    expect(denied.statusCode).toBe(403);

    // mine returns their enterprise.
    const mine = await a.inject({
      method: "GET",
      url: "/api/enterprises/mine",
      headers: asUser(owner),
    });
    expect(mine.json().id).toBe(entId);
  });

  it("admin controls visibility, and the public reveal honours priority + schedule", async () => {
    const a = await getApp();
    const admin = await createUserWithCapabilities([CAPABILITIES.SPONSORS_MANAGE]);

    const mk = async (
      name: string,
      priority: number,
      visibility: string,
      availableFrom: string | null,
    ) => {
      const res = await a.inject({
        method: "POST",
        url: "/api/enterprises",
        headers: asUser(admin),
        payload: { name, displayPriority: priority, visibility, availableFrom },
      });
      return res.json().id;
    };

    await mk("Zeta Primary", 1, "visible", new Date(Date.now() - 3600_000).toISOString());
    await mk("Alpha Second", 2, "visible", null);
    await mk("Hidden", 1, "hidden", null);
    await mk("Future", 1, "visible", new Date(Date.now() + 3600_000).toISOString());

    const pub = await a.inject({ method: "GET", url: "/api/public/sponsors" });
    expect(pub.statusCode).toBe(200);
    // Only the two revealed ones, ordered by priority (1 before 2).
    expect(pub.json().items.map((s: { name: string }) => s.name)).toEqual([
      "Zeta Primary",
      "Alpha Second",
    ]);
  });

  it("logo upload (multipart) requires enterprise edit access", async () => {
    // The bytes go straight to the object store (putObject → MinIO), so the
    // happy path is an integration concern. Here we assert the access guard,
    // which runs before the file is read: an outsider is refused (403).
    const a = await getApp();
    const admin = await createUserWithCapabilities([CAPABILITIES.SPONSORS_MANAGE]);
    const created = await a.inject({
      method: "POST",
      url: "/api/enterprises",
      headers: asUser(admin),
      payload: { name: "LogoCo" },
    });
    const entId = created.json().id;

    const outsider = await createUserWithCapabilities([]);
    const res = await a.inject({
      method: "POST",
      url: `/api/enterprises/${entId}/logo`,
      headers: asUser(outsider),
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects duplicate enterprise names", async () => {
    const a = await getApp();
    const admin = await createUserWithCapabilities([CAPABILITIES.SPONSORS_MANAGE]);
    const payload = { name: "Dupe" };
    const first = await a.inject({
      method: "POST",
      url: "/api/enterprises",
      headers: asUser(admin),
      payload,
    });
    expect(first.statusCode).toBe(201);
    const second = await a.inject({
      method: "POST",
      url: "/api/enterprises",
      headers: asUser(admin),
      payload,
    });
    expect(second.statusCode).toBe(409);
  });
});
