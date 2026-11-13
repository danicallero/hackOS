import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { describe, expect, it } from "vitest";
import { pool } from "../../src/db/pool.js";
import { asUser, createUser, createUserWithCapabilities, useTestApp } from "../helpers.js";

/** H48/H44: speakers and companies on schedule items, written and read back. */

const getApp = useTestApp();

async function enterprise(name: string, visibility = "visible"): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO enterprises (name, visibility) VALUES ($1, $2) RETURNING id`,
    [name, visibility],
  );
  return rows[0].id;
}

const window = {
  startsAt: "2030-05-01T10:00:00.000Z",
  endsAt: "2030-05-01T11:00:00.000Z",
};

describe("schedule speakers and companies", () => {
  it("creates with ordered speakers and companies, lists them, audits the write", async () => {
    const a = await getApp();
    const manager = await createUserWithCapabilities([CAPABILITIES.SCHEDULE_MANAGE]);
    const first = await createUser({ name: "Ada" });
    const second = await createUser({ name: "Bo" });
    await pool.query(`UPDATE users SET surname = 'Peep' WHERE id = $1`, [second]);
    const acme = await enterprise("Acme");
    await pool.query(`INSERT INTO sponsors (enterprise_id, user_id) VALUES ($1, $2)`, [
      acme,
      second,
    ]);

    const res = await a.inject({
      method: "POST",
      url: "/api/schedule",
      headers: asUser(manager),
      payload: {
        title: "Keynote",
        ...window,
        audiences: ["participant"],
        visibility: "shown",
        speakerUserIds: [second, first],
        enterpriseIds: [acme],
      },
    });
    expect(res.statusCode).toBe(201);
    const created = res.json();
    expect(created.speakers.map((s: { userId: number }) => s.userId)).toEqual([second, first]);
    expect(created.speakers[0]).toMatchObject({
      name: "Bo Peep",
      avatarUrl: null,
      enterpriseId: acme,
      enterpriseName: "Acme",
    });
    expect(created.enterprises).toEqual([{ id: acme, name: "Acme", logoUrl: null }]);

    const list = await a.inject({ method: "GET", url: "/api/schedule", headers: asUser(manager) });
    const listed = list.json().items.find((i: { id: number }) => i.id === created.id);
    expect(listed.speakers).toHaveLength(2);
    expect(listed.enterprises).toHaveLength(1);

    const feed = await a.inject({ method: "GET", url: "/api/public/activities" });
    const publicItem = feed.json().items.find((i: { id: number }) => i.id === created.id);
    expect(publicItem.speakers.map((s: { userId: number }) => s.userId)).toEqual([second, first]);

    const { rows } = await pool.query(
      `SELECT after FROM audit_log WHERE entity_type = 'schedule' AND action = 'create' AND entity_id = $1`,
      [String(created.id)],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].after).toMatchObject({ speakerUserIds: [second, first], enterpriseIds: [acme] });
  });

  it("replaces on patch, keeps on omission, and clears with an empty list", async () => {
    const a = await getApp();
    const manager = await createUserWithCapabilities([CAPABILITIES.SCHEDULE_MANAGE]);
    const ada = await createUser();
    const bo = await createUser();
    const acme = await enterprise("Acme");
    const created = (
      await a.inject({
        method: "POST",
        url: "/api/schedule",
        headers: asUser(manager),
        payload: { title: "Talk", ...window, speakerUserIds: [ada], enterpriseIds: [acme] },
      })
    ).json();

    const swapped = await a.inject({
      method: "PATCH",
      url: `/api/schedule/${created.id}`,
      headers: asUser(manager),
      payload: { speakerUserIds: [bo, ada] },
    });
    expect(swapped.statusCode).toBe(200);
    expect(swapped.json().speakers.map((s: { userId: number }) => s.userId)).toEqual([bo, ada]);
    expect(swapped.json().enterprises).toHaveLength(1);

    const cleared = await a.inject({
      method: "PATCH",
      url: `/api/schedule/${created.id}`,
      headers: asUser(manager),
      payload: { enterpriseIds: [] },
    });
    expect(cleared.json().enterprises).toEqual([]);
    expect(cleared.json().speakers).toHaveLength(2);

    const { rows } = await pool.query(
      `SELECT before, after FROM audit_log WHERE entity_type = 'schedule' AND action = 'update' AND entity_id = $1 ORDER BY id`,
      [String(created.id)],
    );
    expect(rows[0].before.speakerUserIds).toEqual([ada]);
    expect(rows[0].after.speakerUserIds).toEqual([bo, ada]);
  });

  it("rejects unknown speakers and companies without saving anything", async () => {
    const a = await getApp();
    const manager = await createUserWithCapabilities([CAPABILITIES.SCHEDULE_MANAGE]);
    const bad = await a.inject({
      method: "POST",
      url: "/api/schedule",
      headers: asUser(manager),
      payload: { title: "Nope", ...window, speakerUserIds: [999999] },
    });
    expect(bad.statusCode).toBe(400);
    const badCompany = await a.inject({
      method: "POST",
      url: "/api/schedule",
      headers: asUser(manager),
      payload: { title: "Nope", ...window, enterpriseIds: [999999] },
    });
    expect(badCompany.statusCode).toBe(400);
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM schedule`);
    expect(rows[0].n).toBe(0);
  });

  it("needs the schedule manage capability", async () => {
    const a = await getApp();
    const reader = await createUserWithCapabilities([CAPABILITIES.SCHEDULE_READ]);
    const res = await a.inject({
      method: "POST",
      url: "/api/schedule",
      headers: asUser(reader),
      payload: { title: "Nope", ...window },
    });
    expect(res.statusCode).toBe(403);
  });

  it("hides a hidden company from the public feed but not from staff", async () => {
    const a = await getApp();
    const manager = await createUserWithCapabilities([CAPABILITIES.SCHEDULE_MANAGE]);
    const secret = await enterprise("Secret", "hidden");
    const shown = await enterprise("Shown");
    const created = (
      await a.inject({
        method: "POST",
        url: "/api/schedule",
        headers: asUser(manager),
        payload: {
          title: "Panel",
          ...window,
          audiences: ["participant"],
          visibility: "shown",
          enterpriseIds: [secret, shown],
        },
      })
    ).json();
    const feed = await a.inject({ method: "GET", url: "/api/public/activities" });
    const item = feed.json().items.find((i: { id: number }) => i.id === created.id);
    expect(item.enterprises.map((e: { name: string }) => e.name)).toEqual(["Shown"]);
    const staff = await a.inject({ method: "GET", url: "/api/schedule", headers: asUser(manager) });
    const staffItem = staff.json().items.find((i: { id: number }) => i.id === created.id);
    expect(staffItem.enterprises).toHaveLength(2);
  });

  it("drops a removed speaker's links with the account", async () => {
    const a = await getApp();
    const manager = await createUserWithCapabilities([CAPABILITIES.SCHEDULE_MANAGE]);
    const ada = await createUser();
    const created = (
      await a.inject({
        method: "POST",
        url: "/api/schedule",
        headers: asUser(manager),
        payload: { title: "Talk", ...window, speakerUserIds: [ada] },
      })
    ).json();
    await pool.query(`DELETE FROM users WHERE id = $1`, [ada]);
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM schedule_speakers WHERE schedule_id = $1`,
      [created.id],
    );
    expect(rows[0].n).toBe(0);
  });
});
