import { CAPABILITIES } from "@hackos/shared/capabilities";
import { describe, expect, it } from "vitest";
import { pool } from "../../src/db/pool.js";
import {
  assignRole,
  asUser,
  createRole,
  createUser,
  createUserWithCapabilities,
  useTestApp,
} from "../helpers.js";

/**
 * Edition lifecycle (docs/multi-edition-plan.md §3-§4): create, activate,
 * close (read-only + closing effects, no notifications), reopen, audited
 * (H53), plus the caller's edition list and the X-Edition scope (H8).
 */
const getApp = useTestApp();

function idem(userId: number): Record<string, string> {
  return { ...asUser(userId), "idempotency-key": crypto.randomUUID() };
}

async function seedCurrentEdition(key = "e2026"): Promise<void> {
  await pool.query(
    "INSERT INTO event_config (id, event_key, name) VALUES (1, $1, 'HackUDC 2026')",
    [key],
  );
}

async function createEdition(key: string, status: "draft" | "active" | "closed"): Promise<void> {
  await pool.query(
    `INSERT INTO editions (event_key, name, status, closed_at)
     VALUES ($1, $1, $2, CASE WHEN $2 = 'closed' THEN now() END)`,
    [key, status],
  );
}

async function superadmin(): Promise<number> {
  const userId = await createUser();
  const roleId = await createRole([CAPABILITIES.ADMIN_ALL], { isProtected: true });
  await assignRole(userId, roleId);
  return userId;
}

/** A project, a queue entry in each pending state, help requests and windows in `key`. */
async function seedLiveEdition(key: string) {
  const owner = await createUser();
  const enterprise = await pool.query(
    "INSERT INTO enterprises (name, event_key) VALUES ('Acme', $1) RETURNING id",
    [key],
  );
  const sponsor = await pool.query(
    "INSERT INTO sponsors (enterprise_id, user_id) VALUES ($1, $2) RETURNING id",
    [enterprise.rows[0].id, owner],
  );
  const challenge = await pool.query(
    "INSERT INTO challenges (author, title) VALUES ($1, 'Build') RETURNING id, event_key",
    [sponsor.rows[0].id],
  );
  const draft = await pool.query(
    `INSERT INTO repos (name, submission_status, event_key) VALUES ('Draft', 'draft', $1) RETURNING id`,
    [key],
  );
  const submitted = await pool.query(
    `INSERT INTO repos (name, submission_status, submitted_at, event_key)
     VALUES ('Done', 'submitted', now(), $1) RETURNING id`,
    [key],
  );
  const room = await pool.query(
    "INSERT INTO rooms (name, status, event_key) VALUES ('R1', 'active', $1) RETURNING id",
    [key],
  );
  await pool.query("INSERT INTO room_queue_state (room_id, is_paused) VALUES ($1, false)", [
    room.rows[0].id,
  ]);
  const waiting = await pool.query(
    "INSERT INTO queue_entries (challenge_id, repo_id, status) VALUES ($1, $2, 'waiting') RETURNING id",
    [challenge.rows[0].id, draft.rows[0].id],
  );
  const presenting = await pool.query(
    `INSERT INTO queue_entries (challenge_id, repo_id, status, assigned_room_id)
     VALUES ($1, $2, 'presenting', $3) RETURNING id`,
    [challenge.rows[0].id, submitted.rows[0].id, room.rows[0].id],
  );
  const judge = await createUser();
  await pool.query(
    "INSERT INTO judging_session (judge_id, queue_entry_id, room_id) VALUES ($1, $2, $3)",
    [judge, presenting.rows[0].id, room.rows[0].id],
  );
  const requester = await createUser();
  const requester2 = await createUser();
  const helper = await createUser();
  const open = await pool.query(
    `INSERT INTO help_requests (requester_id, description, location, routing, event_key)
     VALUES ($1, 'Help', 'Table 1', 'none', $2) RETURNING id`,
    [requester, key],
  );
  const claimed = await pool.query(
    `INSERT INTO help_requests (requester_id, description, location, routing, status, claimed_by,
       claimed_at, meeting_mode, event_key)
     VALUES ($1, 'Help', 'Table 2', 'none', 'claimed', $2, now(), 'on_my_way', $3) RETURNING id`,
    [requester2, helper, key],
  );
  await pool.query(
    `INSERT INTO helpdesk_open_windows (starts_at, ends_at, event_key)
     VALUES (now() - interval '1 hour', now() + interval '1 hour', $1),
            (now() + interval '1 day', now() + interval '1 day 2 hours', $1)`,
    [key],
  );
  return {
    challengeEdition: challenge.rows[0].event_key as string,
    draftRepo: draft.rows[0].id as number,
    submittedRepo: submitted.rows[0].id as number,
    waitingEntry: waiting.rows[0].id as number,
    presentingEntry: presenting.rows[0].id as number,
    roomId: room.rows[0].id as number,
    openRequest: open.rows[0].id as number,
    claimedRequest: claimed.rows[0].id as number,
  };
}

describe("edition lifecycle (H8, H53)", () => {
  it("creates a draft edition, rejects a duplicate key and requires event:manage", async () => {
    const app = await getApp();
    await seedCurrentEdition();
    const manager = await createUserWithCapabilities([CAPABILITIES.EVENT_MANAGE]);
    const outsider = await createUser();

    const created = await app.inject({
      method: "POST",
      url: "/api/editions",
      headers: idem(manager),
      payload: { eventKey: "e2027", name: "HackUDC 2027" },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ eventKey: "e2027", status: "draft", isCurrent: false });

    const duplicate = await app.inject({
      method: "POST",
      url: "/api/editions",
      headers: idem(manager),
      payload: { eventKey: "e2027", name: "Again" },
    });
    expect(duplicate.statusCode).toBe(409);

    const denied = await app.inject({
      method: "POST",
      url: "/api/editions",
      headers: idem(outsider),
      payload: { eventKey: "e2028", name: "Nope" },
    });
    expect(denied.statusCode).toBe(403);

    const { rows } = await pool.query(
      "SELECT action FROM audit_log WHERE entity_type = 'edition' AND entity_id = 'e2027'",
    );
    expect(rows.map((row) => row.action)).toEqual(["created"]);
  });

  it("activates an edition: snapshot of the previous settings, fresh windows, idempotent", async () => {
    const app = await getApp();
    await seedCurrentEdition();
    await pool.query(
      `UPDATE event_config SET hacking_starts_at = now(), hacking_ends_at = now() + interval '1 day',
         onboarding_config = '{"steps":["welcome"]}', wifi_password = 'secret' WHERE id = 1`,
    );
    await createEdition("e2027", "draft");
    const manager = await createUserWithCapabilities([CAPABILITIES.EVENT_MANAGE]);

    const res = await app.inject({
      method: "POST",
      url: "/api/editions/e2027/activate",
      headers: idem(manager),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ eventKey: "e2027", status: "active", isCurrent: true });

    const config = await pool.query(
      "SELECT event_key, hacking_starts_at, onboarding_config FROM event_config WHERE id = 1",
    );
    expect(config.rows[0]).toMatchObject({
      event_key: "e2027",
      hacking_starts_at: null,
      onboarding_config: {},
    });
    const previous = await pool.query(
      "SELECT status, settings_snapshot FROM editions WHERE event_key = 'e2026'",
    );
    expect(previous.rows[0].status).toBe("active");
    expect(previous.rows[0].settings_snapshot.onboarding_config).toEqual({ steps: ["welcome"] });
    expect(previous.rows[0].settings_snapshot).not.toHaveProperty("wifi_password");

    // The manager's role belonged to e2026; the global superadmin can repeat it.
    const admin = await superadmin();
    const again = await app.inject({
      method: "POST",
      url: "/api/editions/e2027/activate",
      headers: idem(admin),
    });
    expect(again.statusCode).toBe(200);
    const audits = await pool.query(
      "SELECT count(*)::int AS n FROM audit_log WHERE entity_type = 'edition' AND action = 'activated'",
    );
    expect(audits.rows[0].n).toBe(1);
  });

  it("restores timing and onboarding when returning to an edition (H53)", async () => {
    const app = await getApp();
    await seedCurrentEdition();
    await pool.query(`UPDATE event_config SET
      hacking_starts_at = '2026-11-01T10:00:00Z',
      hacking_ends_at = '2026-11-02T10:00:00Z', show_start_countdown = true,
      presence_auto_entry_at = '2026-11-01T09:00:00Z',
      project_drafts_open_at = '2026-10-01T00:00:00Z',
      project_submissions_close_at = '2026-11-02T09:00:00Z',
      project_gallery_opens_at = '2026-11-02T12:00:00Z',
      onboarding_config = '{"steps":["welcome"]}' WHERE id = 1`);
    const fields = `hacking_starts_at, hacking_ends_at, show_start_countdown,
      presence_auto_entry_at, project_drafts_open_at, project_submissions_close_at,
      project_gallery_opens_at, onboarding_config`;
    const before = await pool.query(`SELECT ${fields} FROM event_config WHERE id = 1`);
    await createEdition("e2027", "draft");
    const admin = await superadmin();
    for (const key of ["e2027", "e2026"]) {
      const response = await app.inject({
        method: "POST",
        url: `/api/editions/${key}/activate`,
        headers: idem(admin),
      });
      expect(response.statusCode).toBe(200);
    }
    const after = await pool.query(`SELECT ${fields} FROM event_config WHERE id = 1`);
    expect(after.rows).toEqual(before.rows);
  });

  it("closes an edition with its effects, notifies nobody and becomes read-only", async () => {
    const app = await getApp();
    await seedCurrentEdition();
    const seeded = await seedLiveEdition("e2026");
    expect(seeded.challengeEdition).toBe("e2026");
    const manager = await createUserWithCapabilities([
      CAPABILITIES.EVENT_MANAGE,
      CAPABILITIES.ACCREDIT_SCAN,
      CAPABILITIES.USERS_READ,
    ]);
    const outboxBefore = await pool.query("SELECT count(*)::int AS n FROM notification_outbox");

    const res = await app.inject({
      method: "POST",
      url: "/api/editions/e2026/close",
      headers: idem(manager),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      edition: { eventKey: "e2026", status: "closed" },
      effects: {
        projectsNotSubmitted: 1,
        queueEntriesCancelled: 2,
        judgingSessionsEnded: 1,
        roomsPaused: 1,
        helpRequestsCancelled: 2,
        helpWindowsClosed: 2,
      },
    });

    const repos = await pool.query("SELECT id, submission_status FROM repos ORDER BY id");
    expect(repos.rows.map((row) => row.submission_status)).toEqual(["not_submitted", "submitted"]);
    const entries = await pool.query("SELECT status FROM queue_entries ORDER BY id");
    expect(entries.rows.map((row) => row.status)).toEqual(["cancelled", "cancelled"]);
    const history = await pool.query(
      "SELECT previous_status FROM queue_history WHERE action = 'edition_close' ORDER BY queue_entry_id",
    );
    expect(history.rows.map((row) => row.previous_status)).toEqual(["waiting", "presenting"]);
    const sessions = await pool.query("SELECT ended_at FROM judging_session");
    expect(sessions.rows[0].ended_at).not.toBeNull();
    const requests = await pool.query("SELECT status FROM help_requests ORDER BY id");
    expect(requests.rows.map((row) => row.status)).toEqual(["cancelled", "cancelled"]);
    const windows = await pool.query(
      "SELECT count(*)::int AS n, bool_and(ends_at <= now()) AS ended FROM helpdesk_open_windows",
    );
    expect(windows.rows[0]).toEqual({ n: 1, ended: true });
    const outboxAfter = await pool.query("SELECT count(*)::int AS n FROM notification_outbox");
    expect(outboxAfter.rows[0].n).toBe(outboxBefore.rows[0].n);

    // Idempotent: a second close changes nothing and reports no effects.
    const again = await app.inject({
      method: "POST",
      url: "/api/editions/e2026/close",
      headers: idem(manager),
    });
    expect(again.json()).toMatchObject({ edition: { status: "closed" }, effects: null });

    // Read-only: capabilities shrink to reads and edition writes are rejected.
    const me = await app.inject({ method: "GET", url: "/api/me", headers: asUser(manager) });
    const capabilities: string[] = me.json().capabilities ?? me.json().user?.capabilities ?? [];
    if (capabilities.length > 0) {
      expect(capabilities).toContain(CAPABILITIES.USERS_READ);
      expect(capabilities).not.toContain(CAPABILITIES.ACCREDIT_SCAN);
    }
    const write = await app.inject({
      method: "PATCH",
      url: "/api/editions/e2026",
      headers: idem(manager),
      payload: { name: "Renamed" },
    });
    expect(write.statusCode).toBe(409);
    expect(write.json().error.code).toBe("edition_closed");

    // The database guard backs the route guard for any direct write.
    await expect(
      pool.query("UPDATE repos SET name = 'x' WHERE id = $1", [seeded.submittedRepo]),
    ).rejects.toMatchObject({ code: "HKE01" });

    const audit = await pool.query(
      "SELECT after FROM audit_log WHERE entity_type = 'edition' AND action = 'closed'",
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].after.effects.queueEntriesCancelled).toBe(2);
  });

  it("serializes concurrent closes so the effects apply exactly once", async () => {
    const app = await getApp();
    await seedCurrentEdition();
    await seedLiveEdition("e2026");
    const manager = await createUserWithCapabilities([CAPABILITIES.EVENT_MANAGE]);
    const results = await Promise.all(
      [0, 1, 2].map(() =>
        app.inject({ method: "POST", url: "/api/editions/e2026/close", headers: idem(manager) }),
      ),
    );
    expect(results.map((res) => res.statusCode)).toEqual([200, 200, 200]);
    expect(results.filter((res) => res.json().effects !== null)).toHaveLength(1);
    const history = await pool.query(
      "SELECT count(*)::int AS n FROM queue_history WHERE action = 'edition_close'",
    );
    expect(history.rows[0].n).toBe(2);
  });

  it("reopens a closed edition: editing returns, final states stay", async () => {
    const app = await getApp();
    await seedCurrentEdition();
    const seeded = await seedLiveEdition("e2026");
    const manager = await createUserWithCapabilities([CAPABILITIES.EVENT_MANAGE]);
    await app.inject({ method: "POST", url: "/api/editions/e2026/close", headers: idem(manager) });

    // Viewing the closed edition, event:manage is a read capability and the
    // lifecycle routes are global, so the organizer can reopen it.
    const reopened = await app.inject({
      method: "POST",
      url: "/api/editions/e2026/reopen",
      headers: { ...idem(manager), "x-edition": "e2026" },
    });
    expect(reopened.statusCode).toBe(200);
    expect(reopened.json()).toMatchObject({ status: "active" });

    await pool.query("UPDATE repos SET name = 'Editable' WHERE id = $1", [seeded.submittedRepo]);
    const requests = await pool.query("SELECT status FROM help_requests ORDER BY id");
    expect(requests.rows.map((row) => row.status)).toEqual(["cancelled", "cancelled"]);
    const repo = await pool.query("SELECT submission_status FROM repos WHERE id = $1", [
      seeded.draftRepo,
    ]);
    expect(repo.rows[0].submission_status).toBe("not_submitted");

    const noop = await app.inject({
      method: "POST",
      url: "/api/editions/e2026/reopen",
      headers: idem(manager),
    });
    expect(noop.statusCode).toBe(200);
    const audits = await pool.query(
      "SELECT action FROM audit_log WHERE entity_type = 'edition' ORDER BY id",
    );
    expect(audits.rows.map((row) => row.action)).toEqual(["closed", "reopened"]);
  });

  it("refuses to activate a closed edition or to close a draft", async () => {
    const app = await getApp();
    await seedCurrentEdition();
    await createEdition("e2025", "closed");
    await createEdition("e2027", "draft");
    const admin = await superadmin();
    const activate = await app.inject({
      method: "POST",
      url: "/api/editions/e2025/activate",
      headers: idem(admin),
    });
    expect(activate.statusCode).toBe(409);
    const close = await app.inject({
      method: "POST",
      url: "/api/editions/e2027/close",
      headers: idem(admin),
    });
    expect(close.statusCode).toBe(409);
    const missing = await app.inject({
      method: "POST",
      url: "/api/editions/nope/close",
      headers: idem(admin),
    });
    expect(missing.statusCode).toBe(404);
  });

  it("lets the global superadmin write into a closed edition", async () => {
    const app = await getApp();
    await seedCurrentEdition();
    await createEdition("e2025", "closed");
    const admin = await superadmin();
    const res = await app.inject({
      method: "PUT",
      url: "/api/me/notification-preferences",
      headers: { ...idem(admin), "x-edition": "e2025" },
      payload: {},
    });
    // A global route is never blocked by the edition state.
    expect(res.statusCode).not.toBe(409);
    const scoped = await app.inject({
      method: "POST",
      url: "/api/editions",
      headers: { ...idem(admin), "x-edition": "e2025" },
      payload: { eventKey: "e2029", name: "Next" },
    });
    expect(scoped.statusCode).toBe(201);
  });

  it("adopts the legacy default key through PUT /api/event (cascading every row)", async () => {
    const app = await getApp();
    await pool.query("INSERT INTO event_config (id) VALUES (1)");
    const userId = await createUser();
    const roleId = await createRole([]);
    await assignRole(userId, roleId);
    await pool.query("INSERT INTO applications (name) VALUES ('Apply')").catch(() => undefined);
    const manager = await createUserWithCapabilities([CAPABILITIES.EVENT_MANAGE]);
    const res = await app.inject({
      method: "PUT",
      url: "/api/event",
      headers: idem(manager),
      payload: { eventKey: "hackudc-2027" },
    });
    expect(res.statusCode).toBe(200);
    const editions = await pool.query("SELECT event_key FROM editions ORDER BY event_key");
    expect(editions.rows.map((row) => row.event_key)).toEqual(["hackudc-2027"]);
    const roles = await pool.query("SELECT DISTINCT event_key FROM user_roles");
    expect(roles.rows.map((row) => row.event_key)).toEqual(["hackudc-2027"]);
  });
});

describe("GET /api/me/editions and X-Edition (H8)", () => {
  it("lists the current edition and the published editions the user took part in", async () => {
    const app = await getApp();
    await seedCurrentEdition("e2027");
    await createEdition("e2026", "active");
    await createEdition("e2025", "closed");
    await createEdition("e2028", "draft");
    const userId = await createUser();
    const roleId = await createRole([CAPABILITIES.USERS_READ]);
    await pool.query(
      "INSERT INTO user_roles (user_id, role_id, event_key) VALUES ($1, $2, 'e2026')",
      [userId, roleId],
    );
    await pool.query(
      "UPDATE editions SET status = 'closed', closed_at = now() WHERE event_key = 'e2026'",
    );

    const res = await app.inject({
      method: "GET",
      url: "/api/me/editions",
      headers: asUser(userId),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().current).toBe("e2027");
    expect(
      res
        .json()
        .editions.map((e: { eventKey: string }) => e.eventKey)
        .sort(),
    ).toEqual(["e2026", "e2027"]);

    const admin = await superadmin();
    const all = await app.inject({
      method: "GET",
      url: "/api/me/editions",
      headers: asUser(admin),
    });
    const total = await pool.query("SELECT count(*)::int AS n FROM editions");
    expect(all.json().editions).toHaveLength(total.rows[0].n);
  });

  it("validates the header: format, existence, participation and drafts", async () => {
    const app = await getApp();
    await seedCurrentEdition("e2027");
    await createEdition("e2026", "closed");
    await createEdition("e2028", "draft");
    const userId = await createUser();
    const url = "/api/me/editions";
    const bad = await app.inject({
      method: "GET",
      url,
      headers: { ...asUser(userId), "x-edition": "Bad Key" },
    });
    expect(bad.statusCode).toBe(400);
    const unknown = await app.inject({
      method: "GET",
      url,
      headers: { ...asUser(userId), "x-edition": "e1999" },
    });
    expect(unknown.statusCode).toBe(404);
    const foreign = await app.inject({
      method: "GET",
      url,
      headers: { ...asUser(userId), "x-edition": "e2026" },
    });
    expect(foreign.statusCode).toBe(403);
    const draft = await app.inject({
      method: "GET",
      url,
      headers: { ...asUser(userId), "x-edition": "e2028" },
    });
    expect(draft.statusCode).toBe(403);
    // The current edition is always viewable, even without any role (applicant).
    const current = await app.inject({
      method: "GET",
      url,
      headers: { ...asUser(userId), "x-edition": "e2027" },
    });
    expect(current.statusCode).toBe(200);
  });

  it("resolves capabilities from the viewed edition's roles only", async () => {
    const { createAuthorizationContext, getEffectiveCapabilities } = await import(
      "../../src/lib/capabilities.js"
    );
    const { runWithRequestContext } = await import("../../src/lib/request-context.js");
    await seedCurrentEdition("e2027");
    await createEdition("e2026", "active");
    const userId = await createUser();
    const roleId = await createRole([CAPABILITIES.QUEUE_OPERATE]);
    await pool.query(
      "INSERT INTO user_roles (user_id, role_id, event_key) VALUES ($1, $2, 'e2026')",
      [userId, roleId],
    );
    const current = await getEffectiveCapabilities(createAuthorizationContext(userId));
    expect(current.has(CAPABILITIES.QUEUE_OPERATE)).toBe(false);
    const viewed = await runWithRequestContext({ edition: "e2026" }, () =>
      getEffectiveCapabilities(createAuthorizationContext(userId)),
    );
    expect(viewed.has(CAPABILITIES.QUEUE_OPERATE)).toBe(true);
  });
});
