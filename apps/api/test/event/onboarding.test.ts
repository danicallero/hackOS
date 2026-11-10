import { describe, expect, it } from "vitest";
import { pool } from "../../src/db/pool.js";
import { attendanceKind } from "../../src/modules/identity/attendance.js";
import { sampleTemplate } from "../applications/fixtures.js";
import { asUser, createUserWithCapabilities, grantAttendeeRole, useTestApp } from "../helpers.js";

const getApp = useTestApp();

async function attendee() {
  await pool.query("INSERT INTO event_config (id) VALUES (1) ON CONFLICT DO NOTHING");
  return createUserWithCapabilities([]);
}

describe("HackUDC 2027 onboarding", () => {
  it("resolves current-edition steps and reasks after a config revision", async () => {
    const app = await getApp();
    const userId = await attendee();
    const before = await app.inject({
      method: "GET",
      url: "/api/me/onboarding",
      headers: asUser(userId),
    });
    expect(before.statusCode).toBe(200);
    expect(before.json().steps.find((s: { step: string }) => s.step === "welcome")?.status).toBe(
      "pending",
    );
    const decided = await app.inject({
      method: "PUT",
      url: "/api/me/onboarding/welcome",
      headers: asUser(userId),
      payload: { action: "skip" },
    });
    expect(decided.statusCode).toBe(200);
    const manager = await createUserWithCapabilities(["event:manage"]);
    const changed = await app.inject({
      method: "PUT",
      url: "/api/event/onboarding",
      headers: asUser(manager),
      payload: {
        welcome: {
          enabled: true,
          required: false,
          kinds: ["participant", "mentor", "sponsor", "staff"],
          reaskOnChange: false,
        },
      },
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.json().revision).toBe(2);
    const after = await app.inject({
      method: "GET",
      url: "/api/me/onboarding",
      headers: asUser(userId),
    });
    expect(after.json().steps.find((s: { step: string }) => s.step === "welcome")?.status).toBe(
      "pending",
    );
  });

  it("serializes competing decisions and replays one idempotency key once", async () => {
    const app = await getApp();
    const userId = await attendee();
    const headers = { ...asUser(userId), "idempotency-key": "onboarding-decision-1" };
    const request = () =>
      app.inject({
        method: "PUT",
        url: "/api/me/onboarding/welcome",
        headers,
        payload: { action: "skip" },
      });
    const first = await request();
    const replay = await request();
    expect(first.statusCode).toBe(200);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(first.json());
    const { rows: auditRows } = await pool.query(
      "SELECT count(*)::int AS n FROM audit_log WHERE action='onboarding.step_decided'",
    );
    expect(auditRows[0].n).toBe(1);
    const competing = await attendee();
    const one = app.inject({
      method: "PUT",
      url: "/api/me/onboarding/welcome",
      headers: { ...asUser(competing), "idempotency-key": "one" },
      payload: { action: "skip" },
    });
    const two = app.inject({
      method: "PUT",
      url: "/api/me/onboarding/welcome",
      headers: { ...asUser(competing), "idempotency-key": "two" },
      payload: { action: "defer", deferUntil: new Date(Date.now() + 60_000).toISOString() },
    });
    const responses = await Promise.all([one, two]);
    expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  });

  it("keeps participant precedence in the adopted edition and records a repeated role grant in a new edition", async () => {
    const app = await getApp();
    const participant = await attendee();
    await grantAttendeeRole(participant, "participant");
    expect(await attendanceKind(pool, participant)).toBe("participant");
    const manager = await createUserWithCapabilities(["event:manage"]);
    const adopt = await app.inject({
      method: "PUT",
      url: "/api/event",
      headers: asUser(manager),
      payload: { eventKey: "hackudc-2027" },
    });
    expect(adopt.statusCode).toBe(200);
    expect(await attendanceKind(pool, participant)).toBe("participant");
    const next = await app.inject({
      method: "PUT",
      url: "/api/event",
      headers: asUser(manager),
      payload: { eventKey: "hackudc-2028" },
    });
    expect(next.statusCode).toBe(200);
    expect(await attendanceKind(pool, participant)).toBeNull();
    await grantAttendeeRole(participant, "participant");
    expect(await attendanceKind(pool, participant)).toBe("participant");
    const { rows } = await pool.query(
      "SELECT DISTINCT event_key FROM user_role_event_evidence WHERE user_id=$1 ORDER BY event_key",
      [participant],
    );
    expect(rows.map((row) => row.event_key)).toEqual(["hackudc-2027", "hackudc-2028"]);
  });

  it("creates forms with the current edition and explicit attendance kind", async () => {
    const app = await getApp();
    await pool.query("INSERT INTO event_config (id,event_key) VALUES (1,'hackudc-2027')");
    const manager = await createUserWithCapabilities(["applications:manage"]);
    const created = await app.inject({
      method: "POST",
      url: "/api/applications",
      headers: asUser(manager),
      payload: { name: "Mentor form", template: sampleTemplate(), attendance_kind: "mentor" },
    });
    expect(created.statusCode).toBe(201);
    const { rows } = await pool.query(
      "SELECT event_key,attendance_kind FROM applications WHERE id=$1",
      [created.json().id],
    );
    expect(rows[0]).toEqual({ event_key: "hackudc-2027", attendance_kind: "mentor" });
  });

  it("classifies participant evidence ahead of mentor and sponsor, and unknown users fail closed", async () => {
    await pool.query("INSERT INTO event_config (id) VALUES (1)");
    const unknown = await createUserWithCapabilities([]);
    const sponsor = await createUserWithCapabilities([]);
    const { rows: enterprise } = await pool.query(
      "INSERT INTO enterprises (name) VALUES ('Onboarding test') RETURNING id",
    );
    await pool.query("INSERT INTO sponsors (enterprise_id,user_id) VALUES ($1,$2)", [
      enterprise[0].id,
      sponsor,
    ]);
    expect(await attendanceKind(pool, sponsor)).toBe("sponsor");
    await grantAttendeeRole(sponsor, "mentor");
    expect(await attendanceKind(pool, sponsor)).toBe("mentor");
    await grantAttendeeRole(sponsor, "participant");
    expect(await attendanceKind(pool, sponsor)).toBe("participant");
    await pool.query("DELETE FROM user_roles WHERE user_id=$1", [unknown]);
    expect(await attendanceKind(pool, unknown)).toBeNull();
  });

  it("withdraws networking visibility on decline and never makes consent required", async () => {
    const app = await getApp();
    const userId = await attendee();
    await pool.query(
      "INSERT INTO user_public_profiles (user_id,directory_visible,consented_at) VALUES ($1,true,now())",
      [userId],
    );
    const completed = await app.inject({
      method: "PUT",
      url: "/api/me/onboarding/networking",
      headers: asUser(userId),
      payload: { action: "complete" },
    });
    expect(completed.statusCode).toBe(200);
    const response = await app.inject({
      method: "PUT",
      url: "/api/me/onboarding/networking",
      headers: asUser(userId),
      payload: { action: "decline" },
    });
    expect(response.statusCode).toBe(200);
    const { rows } = await pool.query(
      "SELECT directory_visible,consented_at FROM user_public_profiles WHERE user_id=$1",
      [userId],
    );
    expect(rows[0]).toMatchObject({ directory_visible: false, consented_at: null });
    const manager = await createUserWithCapabilities(["event:manage"]);
    const invalid = await app.inject({
      method: "PUT",
      url: "/api/event/onboarding",
      headers: asUser(manager),
      payload: {
        networking: { enabled: true, required: true, kinds: ["staff"], reaskOnChange: false },
      },
    });
    expect(invalid.statusCode).toBe(400);
  });
});
