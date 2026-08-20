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

/**
 * H59: audience scoping — staff always sees everything (never stored);
 * `sponsor`/`participant`/`mentor` are the optional stored toggles, empty
 * meaning staff-only; an anonymous caller is treated as `participant`. Plus
 * the responsible-person ("owner") join table and the staff-only `notes`
 * field.
 */

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

async function createItem(opts: {
  title: string;
  audiences: string[];
  notes?: string | null;
  contactNote?: string | null;
}): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO schedule (title, starts_at, ends_at, visibility, audiences, notes, contact_note)
     VALUES ($1, now() + interval '1 day', now() + interval '1 day 1 hour', 'shown', $2, $3, $4)
     RETURNING id`,
    [opts.title, opts.audiences, opts.notes ?? null, opts.contactNote ?? null],
  );
  return rows[0].id;
}

async function makeAttendee(role: "participant" | "mentor"): Promise<number> {
  const userId = await createUser();
  await pool.query(`INSERT INTO manual_attendee_roles (user_id, role) VALUES ($1, $2)`, [
    userId,
    role,
  ]);
  return userId;
}

describe("audience-aware schedule feed (H59)", () => {
  it("anonymous callers are treated as participant", async () => {
    const a = await getApp();
    await createItem({ title: "Opening ceremony", audiences: ["participant"] });
    await createItem({ title: "Staff-only prep", audiences: [] });
    await createItem({ title: "Sponsor reception", audiences: ["sponsor"] });
    await createItem({ title: "Mentor briefing", audiences: ["mentor"] });

    const res = await a.inject({ method: "GET", url: "/api/public/activities" });
    const items = res.json().items;
    expect(items.map((i: { title: string }) => i.title)).toEqual(["Opening ceremony"]);
    expect(items[0].audiences).toEqual(["participant"]);
  });

  it("a capability-holding staff member sees the full run-of-show — every live item regardless of audience — each with notes and owners", async () => {
    const a = await getApp();
    const staffUser = await createUserWithCapabilities([CAPABILITIES.ACTIVITY_SCAN]);
    const participantId = await createItem({
      title: "Opening ceremony",
      audiences: ["participant"],
    });
    const staffOnlyId = await createItem({
      title: "Staff-only prep",
      audiences: [],
      notes: "Set up chairs",
      contactNote: "Ask at the info desk",
    });
    const sponsorId = await createItem({ title: "Sponsor reception", audiences: ["sponsor"] });
    const mentorId = await createItem({ title: "Mentor briefing", audiences: ["mentor"] });

    const res = await a.inject({
      method: "GET",
      url: "/api/public/activities",
      headers: asUser(staffUser),
    });
    const items = res.json().items;
    expect(items.map((i: { id: number }) => i.id).sort()).toEqual(
      [participantId, staffOnlyId, sponsorId, mentorId].sort(),
    );

    for (const id of [participantId, staffOnlyId, sponsorId, mentorId]) {
      const item = items.find((i: { id: number }) => i.id === id);
      expect(item.notes).toBeDefined();
      expect(item.owners).toBeDefined();
    }
    const staffOnlyItem = items.find((i: { id: number }) => i.id === staffOnlyId);
    expect(staffOnlyItem.notes).toBe("Set up chairs");
    expect(staffOnlyItem.contactNote).toBe("Ask at the info desk");
  });

  it("a sponsor rep sees the entire public schedule plus their sponsor-tagged items, with owners/contact but never the staff-only notes", async () => {
    const a = await getApp();
    const { rows } = await pool.query(
      `INSERT INTO enterprises (name, visibility) VALUES ('Acme', 'hidden') RETURNING id`,
    );
    const rep = await createUser();
    await pool.query(`INSERT INTO sponsors (enterprise_id, user_id) VALUES ($1, $2)`, [
      rows[0].id,
      rep,
    ]);
    const sponsorId = await createItem({
      title: "Sponsor reception",
      audiences: ["sponsor"],
      notes: "Print badges",
      contactNote: "Ask for Jamie",
    });
    const participantId = await createItem({
      title: "Opening ceremony",
      audiences: ["participant"],
    });
    await createItem({ title: "Mentor briefing", audiences: ["mentor"] });

    const res = await a.inject({
      method: "GET",
      url: "/api/public/activities",
      headers: asUser(rep),
    });
    const items = res.json().items;
    expect(items.map((i: { id: number }) => i.id).sort()).toEqual(
      [sponsorId, participantId].sort(),
    );
    const sponsorItem = items.find((i: { id: number }) => i.id === sponsorId);
    expect(sponsorItem.contactNote).toBe("Ask for Jamie");
    expect(sponsorItem.notes).toBeUndefined();
    const participantItem = items.find((i: { id: number }) => i.id === participantId);
    expect(participantItem.owners).toBeUndefined();
    expect(participantItem.contactNote).toBeUndefined();
  });

  it("a confirmed mentor sees mentor-tagged items but not participant- or sponsor-only ones", async () => {
    const a = await getApp();
    const mentor = await makeAttendee("mentor");
    const mentorId = await createItem({ title: "Mentor briefing", audiences: ["mentor"] });
    await createItem({ title: "Opening ceremony", audiences: ["participant"] });
    await createItem({ title: "Sponsor reception", audiences: ["sponsor"] });

    const res = await a.inject({
      method: "GET",
      url: "/api/public/activities",
      headers: asUser(mentor),
    });
    expect(res.json().items.map((i: { id: number }) => i.id)).toEqual([mentorId]);
  });

  it("a confirmed participant sees participant-tagged items but not mentor- or sponsor-only ones", async () => {
    const a = await getApp();
    const participant = await makeAttendee("participant");
    const participantId = await createItem({
      title: "Opening ceremony",
      audiences: ["participant"],
    });
    await createItem({ title: "Mentor briefing", audiences: ["mentor"] });
    await createItem({ title: "Sponsor reception", audiences: ["sponsor"] });

    const res = await a.inject({
      method: "GET",
      url: "/api/public/activities",
      headers: asUser(participant),
    });
    expect(res.json().items.map((i: { id: number }) => i.id)).toEqual([participantId]);
  });
});

describe("scan requires participant audience (H59)", () => {
  it("rejects creating a scannable item that isn't participant-visible", async () => {
    const a = await getApp();
    const admin = await createUserWithCapabilities([CAPABILITIES.SCHEDULE_MANAGE]);
    const res = await a.inject({
      method: "POST",
      url: "/api/schedule",
      headers: asUser(admin),
      payload: {
        title: "Staff-only meal",
        startsAt: new Date(Date.now() + 3_600_000).toISOString(),
        endsAt: new Date(Date.now() + 7_200_000).toISOString(),
        visibility: "hidden",
        requiresScan: true,
        audiences: ["mentor"],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects flipping a scannable item's audience away from participant", async () => {
    const a = await getApp();
    const admin = await createUserWithCapabilities([CAPABILITIES.SCHEDULE_MANAGE]);
    const created = await a.inject({
      method: "POST",
      url: "/api/schedule",
      headers: asUser(admin),
      payload: {
        title: "Lunch",
        startsAt: new Date(Date.now() + 3_600_000).toISOString(),
        endsAt: new Date(Date.now() + 7_200_000).toISOString(),
        visibility: "hidden",
        requiresScan: true,
        audiences: ["participant"],
      },
    });
    expect(created.statusCode).toBe(201);
    const res = await a.inject({
      method: "PATCH",
      url: `/api/schedule/${created.json().id}`,
      headers: asUser(admin),
      payload: { audiences: ["mentor"] },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("schedule owner candidates (H59)", () => {
  it("SCHEDULE_MANAGE (without USERS_READ) can search for a colleague to assign", async () => {
    const a = await getApp();
    const admin = await createUserWithCapabilities([CAPABILITIES.SCHEDULE_MANAGE]);
    await createUser(); // some other user, distinguishable by email prefix below
    const target = await createUser();
    const { rows } = await pool.query(`SELECT email FROM users WHERE id = $1`, [target]);
    const emailPrefix = rows[0].email.slice(0, 6);

    const res = await a.inject({
      method: "GET",
      url: `/api/schedule/owner-candidates?q=${encodeURIComponent(emailPrefix)}`,
      headers: asUser(admin),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().users.some((u: { id: number }) => u.id === target)).toBe(true);
  });

  it("is forbidden without SCHEDULE_MANAGE", async () => {
    const a = await getApp();
    const outsider = await createUser();
    const res = await a.inject({
      method: "GET",
      url: "/api/schedule/owner-candidates?q=ab",
      headers: asUser(outsider),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("schedule owners (H59)", () => {
  it("SCHEDULE_MANAGE can assign and unassign an owner, audited both ways", async () => {
    const a = await getApp();
    const admin = await createUserWithCapabilities([CAPABILITIES.SCHEDULE_MANAGE]);
    const owner = await createUser();
    const scheduleId = await createItem({ title: "Sponsor reception", audiences: ["sponsor"] });

    const add = await a.inject({
      method: "POST",
      url: `/api/schedule/${scheduleId}/owners`,
      headers: asUser(admin),
      payload: { userId: owner },
    });
    expect(add.statusCode).toBe(201);

    const list = await a.inject({
      method: "GET",
      url: `/api/schedule/${scheduleId}/owners`,
      headers: asUser(admin),
    });
    expect(list.json().owners.map((o: { userId: number }) => o.userId)).toEqual([owner]);

    const dup = await a.inject({
      method: "POST",
      url: `/api/schedule/${scheduleId}/owners`,
      headers: asUser(admin),
      payload: { userId: owner },
    });
    expect(dup.statusCode).toBe(409);

    const remove = await a.inject({
      method: "DELETE",
      url: `/api/schedule/${scheduleId}/owners/${owner}`,
      headers: asUser(admin),
    });
    expect(remove.statusCode).toBe(204);

    const { rows } = await pool.query(
      `SELECT action FROM audit_log WHERE entity_type = 'schedule_owner' AND entity_id = $1 ORDER BY id`,
      [`${scheduleId}:${owner}`],
    );
    expect(rows.map((r) => r.action)).toEqual(["create", "delete"]);
  });

  it("a non-SCHEDULE_MANAGE user cannot assign an owner", async () => {
    const a = await getApp();
    const outsider = await createUser();
    const scheduleId = await createItem({ title: "Sponsor reception", audiences: ["sponsor"] });
    const res = await a.inject({
      method: "POST",
      url: `/api/schedule/${scheduleId}/owners`,
      headers: asUser(outsider),
      payload: { userId: outsider },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("bulk schedule publish-at (H59)", () => {
  it("SCHEDULE_MANAGE can set a shared reveal time for several hidden items at once", async () => {
    const a = await getApp();
    const admin = await createUserWithCapabilities([CAPABILITIES.SCHEDULE_MANAGE]);
    const a1 = await createItem({ title: "Item A", audiences: ["participant"] });
    const a2 = await createItem({ title: "Item B", audiences: ["participant"] });
    const publishAt = new Date(Date.now() + 3_600_000).toISOString();

    const res = await a.inject({
      method: "POST",
      url: "/api/schedule/publish-at",
      headers: asUser(admin),
      payload: { ids: [a1, a2], publishAt },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().updated).toBe(2);

    const { rows } = await pool.query(
      `SELECT id, publish_at FROM schedule WHERE id = ANY($1::int[]) ORDER BY id`,
      [[a1, a2]],
    );
    for (const row of rows) {
      expect(new Date(row.publish_at).toISOString()).toBe(publishAt);
    }
  });

  it("is forbidden without SCHEDULE_MANAGE", async () => {
    const a = await getApp();
    const outsider = await createUser();
    const id = await createItem({ title: "Item", audiences: ["participant"] });
    const res = await a.inject({
      method: "POST",
      url: "/api/schedule/publish-at",
      headers: asUser(outsider),
      payload: { ids: [id], publishAt: new Date().toISOString() },
    });
    expect(res.statusCode).toBe(403);
  });
});
