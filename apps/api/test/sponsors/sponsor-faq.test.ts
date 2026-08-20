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

/** H58: sponsor-only logistics/FAQ — readable by sponsor reps and admins, writable by admins. */

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

const EMPTY_I18N = { en: "", es: "", gl: "" };

describe("sponsor FAQ (H58)", () => {
  it("a linked sponsor rep can read the FAQ but not write it", async () => {
    const a = await getApp();
    const { rows } = await pool.query(
      `INSERT INTO enterprises (name, visibility) VALUES ('Acme', 'hidden') RETURNING id`,
    );
    const rep = await createUser();
    await linkSponsor(rep, rows[0].id);

    const read = await a.inject({ method: "GET", url: "/api/sponsor-faq", headers: asUser(rep) });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toEqual({ items: [] });

    const write = await a.inject({
      method: "PUT",
      url: "/api/sponsor-faq",
      headers: asUser(rep),
      payload: {
        items: [
          { kind: "qa", heading: { ...EMPTY_I18N, en: "When can we load in?" }, body: EMPTY_I18N },
        ],
      },
    });
    expect(write.statusCode).toBe(403);
  });

  it("a user with no sponsor relationship is forbidden from reading", async () => {
    const a = await getApp();
    const outsider = await createUser();
    const res = await a.inject({
      method: "GET",
      url: "/api/sponsor-faq",
      headers: asUser(outsider),
    });
    expect(res.statusCode).toBe(403);
  });

  it("SPONSORS_MANAGE can write a mix of Q&A and text-block items, and the write is auditable", async () => {
    const a = await getApp();
    const admin = await createUserWithCapabilities([CAPABILITIES.SPONSORS_MANAGE]);

    const items = [
      {
        kind: "qa",
        heading: { ...EMPTY_I18N, en: "When can we load in?" },
        body: { ...EMPTY_I18N, en: "From 8am on Friday." },
      },
      {
        kind: "text",
        heading: { ...EMPTY_I18N, en: "Wifi" },
        body: { ...EMPTY_I18N, en: "SSID: hackos, password: hackos" },
      },
    ];

    const write = await a.inject({
      method: "PUT",
      url: "/api/sponsor-faq",
      headers: asUser(admin),
      payload: { items },
    });
    expect(write.statusCode).toBe(200);
    expect(write.json().items).toHaveLength(2);
    expect(write.json().items[0].kind).toBe("qa");
    expect(write.json().items[1].heading.en).toBe("Wifi");

    const read = await a.inject({
      method: "GET",
      url: "/api/sponsor-faq",
      headers: asUser(admin),
    });
    expect(read.json().items).toHaveLength(2);

    const { rows } = await pool.query(
      `SELECT action FROM audit_log WHERE entity_type = 'sponsor_faq' AND entity_id = '1'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("updated");
  });
});
