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

  it("requires an exact enterprise relationship and preserves wildcard access", async () => {
    const a = await getApp();
    const admin = await createUserWithCapabilities([CAPABILITIES.SPONSORS_MANAGE]);
    const first = await a.inject({
      method: "POST",
      url: "/api/enterprises",
      headers: asUser(admin),
      payload: { name: "First contextual" },
    });
    const second = await a.inject({
      method: "POST",
      url: "/api/enterprises",
      headers: asUser(admin),
      payload: { name: "Second contextual" },
    });
    const owner = await createUser();
    await linkSponsor(owner, first.json().id);

    expect(
      (await a.inject({ method: "GET", url: `/api/enterprises/${first.json().id}` })).statusCode,
    ).toBe(401);
    expect(
      (
        await a.inject({
          method: "PATCH",
          url: `/api/enterprises/${second.json().id}`,
          headers: asUser(owner),
          payload: { description: "foreign" },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await a.inject({
          method: "PATCH",
          url: `/api/enterprises/${first.json().id}`,
          headers: asUser(owner),
          payload: { description: "owned" },
        })
      ).statusCode,
    ).toBe(200);

    const wildcard = await createUserWithCapabilities([CAPABILITIES.ADMIN_ALL]);
    expect(
      (
        await a.inject({
          method: "PATCH",
          url: `/api/enterprises/${second.json().id}`,
          headers: asUser(wildcard),
          payload: { description: "global" },
        })
      ).statusCode,
    ).toBe(200);
  });

  it("returns both logo variants, falling back to the standard logo", async () => {
    const a = await getApp();
    const admin = await createUserWithCapabilities([CAPABILITIES.SPONSORS_MANAGE]);
    const original = "https://cdn.example/logo.png";
    const negative = "https://cdn.example/logo-negative.png";

    const created = await a.inject({
      method: "POST",
      url: "/api/enterprises",
      headers: asUser(admin),
      payload: { name: "Logo variants", logoUrl: original },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ logo_url: original, logo_negative_url: original });

    const updated = await a.inject({
      method: "PATCH",
      url: `/api/enterprises/${created.json().id}`,
      headers: asUser(admin),
      payload: { logoNegativeUrl: negative },
    });
    expect(updated.statusCode).toBe(200);

    const listed = await a.inject({
      method: "GET",
      url: "/api/enterprises",
      headers: asUser(admin),
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().enterprises).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ logo_url: original, logo_negative_url: negative }),
      ]),
    );
  });

  it("admin controls visibility, and the public reveal honours priority", async () => {
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
    // Visible rows are public immediately; reveal time is only a trigger.
    expect(pub.json().items.map((s: { name: string }) => s.name)).toEqual([
      "Future",
      "Zeta Primary",
      "Alpha Second",
    ]);
  });

  it("scheduled visibility worker flips due hidden enterprises and leaves future triggers hidden", async () => {
    const make = async (name: string) =>
      (
        await pool.query(
          `INSERT INTO enterprises (name, visibility) VALUES ($1, 'hidden') RETURNING id`,
          [name],
        )
      ).rows[0].id as number;
    const due = await make("Due Enterprise");
    const future = await make("Future Enterprise");
    const alreadyVisible = await make("Visible Enterprise");
    await pool.query(
      `UPDATE enterprises
          SET visibility = CASE WHEN id = $3 THEN 'visible' ELSE 'hidden' END,
              available_from = CASE
                WHEN id = $1 THEN now() - interval '1 minute'
                WHEN id = $2 THEN now() + interval '1 hour'
                WHEN id = $3 THEN now() + interval '1 hour'
              END
        WHERE id = ANY($4::int[])`,
      [due, future, alreadyVisible, [due, future, alreadyVisible]],
    );

    const { runScheduledVisibilityPublisherOnce } = await import(
      "../../src/modules/challenges/visibility-publisher.js"
    );
    const result = await runScheduledVisibilityPublisherOnce();
    expect(result.enterprises).toEqual([due]);

    const { rows } = await pool.query(
      `SELECT id, visibility FROM enterprises WHERE id = ANY($1::int[]) ORDER BY id`,
      [[due, future, alreadyVisible]],
    );
    expect(Object.fromEntries(rows.map((r) => [Number(r.id), r.visibility]))).toEqual({
      [due]: "visible",
      [future]: "hidden",
      [alreadyVisible]: "visible",
    });
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

describe("enterprise membership (M4)", () => {
  async function makeEnterprise(adminId: number, name = "MemberCo"): Promise<number> {
    const a = await getApp();
    const res = await a.inject({
      method: "POST",
      url: "/api/enterprises",
      headers: asUser(adminId),
      payload: { name },
    });
    return res.json().id;
  }

  it("admin adds, lists and removes affiliated users; duplicates 409", async () => {
    const a = await getApp();
    const admin = await createUserWithCapabilities([CAPABILITIES.SPONSORS_MANAGE]);
    const entId = await makeEnterprise(admin);
    const member = await createUserWithCapabilities([CAPABILITIES.SPONSOR_PORTAL]);

    // add
    const add = await a.inject({
      method: "POST",
      url: `/api/enterprises/${entId}/members`,
      headers: asUser(admin),
      payload: { userId: member },
    });
    expect(add.statusCode).toBe(201);
    expect(add.json().userId).toBe(member);

    // duplicate → 409
    expect(
      (
        await a.inject({
          method: "POST",
          url: `/api/enterprises/${entId}/members`,
          headers: asUser(admin),
          payload: { userId: member },
        })
      ).statusCode,
    ).toBe(409);

    // list
    const list = await a.inject({
      method: "GET",
      url: `/api/enterprises/${entId}/members`,
      headers: asUser(admin),
    });
    expect(list.json().members).toHaveLength(1);
    expect(list.json().members[0].userId).toBe(member);

    // the user's own enterprises reflect the link
    const reader = await createUserWithCapabilities([CAPABILITIES.USERS_READ]);
    const mine = await a.inject({
      method: "GET",
      url: `/api/users/${member}/enterprises`,
      headers: asUser(reader),
    });
    expect(mine.json().enterprises).toHaveLength(1);

    // remove
    const del = await a.inject({
      method: "DELETE",
      url: `/api/enterprises/${entId}/members/${member}`,
      headers: asUser(admin),
    });
    expect(del.statusCode).toBe(200);
    expect(del.json().removed).toBe(true);
    const after = await a.inject({
      method: "GET",
      url: `/api/enterprises/${entId}/members`,
      headers: asUser(admin),
    });
    expect(after.json().members).toHaveLength(0);
  });

  it("requires SPONSORS_MANAGE to add members; 404 for unknown user/enterprise", async () => {
    const a = await getApp();
    const admin = await createUserWithCapabilities([CAPABILITIES.SPONSORS_MANAGE]);
    const entId = await makeEnterprise(admin, "GuardCo");
    const pleb = await createUserWithCapabilities([CAPABILITIES.SPONSOR_PORTAL]);

    expect(
      (
        await a.inject({
          method: "POST",
          url: `/api/enterprises/${entId}/members`,
          headers: asUser(pleb),
          payload: { userId: pleb },
        })
      ).statusCode,
    ).toBe(403);

    expect(
      (
        await a.inject({
          method: "POST",
          url: `/api/enterprises/${entId}/members`,
          headers: asUser(admin),
          payload: { userId: 999999 },
        })
      ).statusCode,
    ).toBe(404);

    expect(
      (
        await a.inject({
          method: "DELETE",
          url: `/api/enterprises/${entId}/members/999999`,
          headers: asUser(admin),
        })
      ).statusCode,
    ).toBe(404);
  });

  it("admin bulk-reveals and hides enterprises from the list (H45)", async () => {
    const a = await getApp();
    const admin = await createUserWithCapabilities([CAPABILITIES.SPONSORS_MANAGE]);
    const make = async (name: string) =>
      (
        await a.inject({
          method: "POST",
          url: "/api/enterprises",
          headers: asUser(admin),
          payload: { name, visibility: "hidden" },
        })
      ).json().id as number;
    const one = await make("Bulk One");
    const two = await make("Bulk Two");

    const reveal = await a.inject({
      method: "POST",
      url: "/api/enterprises/visibility",
      headers: asUser(admin),
      payload: { ids: [one, two], visible: true },
    });
    expect(reveal.statusCode).toBe(200);
    expect(reveal.json().updated).toEqual(expect.arrayContaining([one, two]));

    const pub = await a.inject({ method: "GET", url: "/api/public/sponsors" });
    const names = pub.json().items.map((s: { name: string }) => s.name);
    expect(names).toEqual(expect.arrayContaining(["Bulk One", "Bulk Two"]));

    await a.inject({
      method: "POST",
      url: "/api/enterprises/visibility",
      headers: asUser(admin),
      payload: { ids: [one], visible: false },
    });
    const pubAfter = await a.inject({ method: "GET", url: "/api/public/sponsors" });
    const namesAfter = pubAfter.json().items.map((s: { name: string }) => s.name);
    expect(namesAfter).not.toContain("Bulk One");
    expect(namesAfter).toContain("Bulk Two");
  });

  it("keeps synthetic sponsor graphs scoped to synthetic operators", async () => {
    const a = await getApp();
    const realAdmin = await createUserWithCapabilities([CAPABILITIES.SPONSORS_MANAGE]);
    const fixtureAdmin = await createUserWithCapabilities([CAPABILITIES.SPONSORS_MANAGE]);
    const fixtureMember = await createUser();
    await pool.query(`UPDATE users SET is_test_account = true WHERE id IN ($1, $2)`, [
      fixtureAdmin,
      fixtureMember,
    ]);
    const enterprise = await pool.query(
      `INSERT INTO enterprises (name, visibility) VALUES ('Synthetic Sponsor', 'visible') RETURNING id`,
    );
    const enterpriseId = Number(enterprise.rows[0].id);
    await pool.query(`INSERT INTO sponsors (enterprise_id, user_id) VALUES ($1, $2), ($1, $3)`, [
      enterpriseId,
      fixtureAdmin,
      fixtureMember,
    ]);

    const realList = await a.inject({
      method: "GET",
      url: "/api/enterprises",
      headers: asUser(realAdmin),
    });
    expect(realList.statusCode).toBe(200);
    expect(realList.json().enterprises.map((row: { id: number }) => row.id)).not.toContain(
      enterpriseId,
    );

    const fixtureList = await a.inject({
      method: "GET",
      url: "/api/enterprises",
      headers: asUser(fixtureAdmin),
    });
    expect(fixtureList.statusCode).toBe(200);
    expect(fixtureList.json().enterprises.map((row: { id: number }) => row.id)).toContain(
      enterpriseId,
    );

    expect(
      (
        await a.inject({
          method: "GET",
          url: `/api/enterprises/${enterpriseId}`,
          headers: asUser(realAdmin),
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await a.inject({
          method: "GET",
          url: `/api/enterprises/${enterpriseId}`,
          headers: asUser(fixtureAdmin),
        })
      ).statusCode,
    ).toBe(200);

    const candidates = await a.inject({
      method: "GET",
      url: `/api/enterprises/${enterpriseId}/judge-candidates`,
      headers: asUser(realAdmin),
    });
    expect(candidates.statusCode).toBe(404);
    const fixtureCandidates = await a.inject({
      method: "GET",
      url: `/api/enterprises/${enterpriseId}/judge-candidates`,
      headers: asUser(fixtureAdmin),
    });
    expect(fixtureCandidates.statusCode).toBe(200);
    expect(fixtureCandidates.json().users.map((row: { id: number }) => row.id)).toContain(
      fixtureMember,
    );

    const publicSponsors = await a.inject({ method: "GET", url: "/api/public/sponsors" });
    expect(
      publicSponsors.json().items.map((row: { enterpriseId: number }) => row.enterpriseId),
    ).not.toContain(enterpriseId);
  });
});
