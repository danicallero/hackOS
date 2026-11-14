import { randomUUID } from "node:crypto";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { expect, it } from "vitest";
import { pool, withTransaction } from "../../src/db/pool.js";
import { audit, auditMany } from "../../src/lib/audit.js";
import { runWithRequestContext } from "../../src/lib/request-context.js";
import {
  type Announcement,
  announcementAuditSnapshot,
} from "../../src/modules/notifications/announcements-service.js";
import { asUser, createUserWithCapabilities, useTestApp } from "../helpers.js";

const getApp = useTestApp();
it("correlates single and batched events and minimizes both stored and legacy snapshots (H53)", async () => {
  const app = await getApp();
  const actor = await createUserWithCapabilities([CAPABILITIES.AUDIT_READ]);
  const requestId = randomUUID();
  const entry = {
    actorId: actor,
    entityType: "user",
    entityId: actor,
    action: "profile_update",
    before: { notes: "PRIVATE old", score: 2 },
    after: { notes: "PRIVATE new", score: 4 },
  };
  await runWithRequestContext({ requestId, ip: "127.0.0.1" }, async () => {
    await audit(pool, entry);
    await auditMany(pool, [{ ...entry, action: "updated" }]);
    await audit(pool, { ...entry, action: "anonymized", actorId: null, ip: null, userAgent: null });
  });
  const stored = await pool.query(
    "SELECT before, after, changed_fields, request_id FROM audit_log ORDER BY id",
  );
  expect(JSON.stringify(stored.rows)).not.toContain("PRIVATE");
  expect(stored.rows.map((row) => row.request_id)).toEqual([requestId, requestId, null]);
  expect(stored.rows[0].changed_fields).toEqual(["notes", "score"]);
  const result = await app.inject({
    method: "GET",
    url: `/api/audit?requestId=${requestId}`,
    headers: asUser(actor),
  });
  expect(result.statusCode).toBe(200);
  expect(result.json().total).toBe(2);
  expect(result.json().items[0].changed_fields).toEqual(["notes", "score"]);
  const legacy = await pool.query(
    "INSERT INTO audit_log(actor_id, entity_type, entity_id, action, before, after) VALUES ($1,'user',$2,'profile_update',$3,$4) RETURNING id",
    [actor, String(actor), JSON.stringify(entry.before), JSON.stringify(entry.after)],
  );
  const detail = await app.inject({
    method: "GET",
    url: `/api/audit/${legacy.rows[0].id}`,
    headers: asUser(actor),
  });
  expect(detail.statusCode).toBe(200);
  expect(JSON.stringify(detail.json())).not.toContain("PRIVATE");
  expect(detail.json().changed_fields).toEqual(["notes", "score"]);
});

it("coalesces only draft edits and retains independent state transitions (H53)", async () => {
  await getApp();
  const actor = await createUserWithCapabilities([CAPABILITIES.AUDIT_READ]);
  const entry = {
    actorId: actor,
    entityType: "project",
    entityId: 123,
    action: "save_draft",
    source: "participant",
    before: { revision: 1 },
    after: { revision: 2 },
  };
  await audit(pool, entry);
  await audit(pool, { ...entry, before: { revision: 2 }, after: { revision: 3 } });
  let result = await pool.query("SELECT * FROM audit_log ORDER BY id");
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0].before).toEqual({ revision: 1 });
  expect(result.rows[0].after).toEqual({ revision: 3 });
  expect(result.rows[0].last_edited_at).not.toBeNull();
  await audit(pool, { ...entry, action: "submit" });
  await audit(pool, { ...entry, action: "submit" });
  await pool.query(
    "UPDATE audit_log SET last_edited_at = now() - interval '3 minutes' WHERE action = 'save_draft'",
  );
  await audit(pool, { ...entry, before: { revision: 3 }, after: { revision: 4 } });
  result = await pool.query("SELECT * FROM audit_log ORDER BY id");
  expect(result.rows).toHaveLength(4);
});

it("groups opening-window drags but keeps policy changes separate (H53, H64)", async () => {
  await getApp();
  const actor = await createUserWithCapabilities([CAPABILITIES.AUDIT_READ]);
  const entry = {
    actorId: actor,
    entityType: "helpdesk_schedule",
    entityId: 1,
    action: "replaced",
    changedFields: ["windows"],
    before: { windows: [] },
    after: { windows: [] },
  };
  await audit(pool, entry);
  await audit(pool, entry);
  expect((await pool.query("SELECT id FROM audit_log")).rows).toHaveLength(1);
  await audit(pool, {
    ...entry,
    changedFields: ["eventAccessOnly"],
    before: { eventAccessOnly: true },
    after: { eventAccessOnly: false },
  });
  await audit(pool, entry);
  const { rows } = await pool.query("SELECT changed_fields, after FROM audit_log ORDER BY id");
  expect(rows).toHaveLength(3);
  expect(rows[1]).toMatchObject({
    changed_fields: ["eventAccessOnly"],
    after: { eventAccessOnly: false },
  });
});

it("searches system work by its human initiator without making them the executor (H53)", async () => {
  const app = await getApp();
  const actor = await createUserWithCapabilities([CAPABILITIES.AUDIT_READ]);
  await audit(pool, {
    actorId: actor,
    entityType: "role",
    entityId: 3,
    action: "assign_user",
    source: "system",
    after: { userId: 44 },
  });
  const result = await app.inject({
    method: "GET",
    url: `/api/audit?actorId=${actor}`,
    headers: asUser(actor),
  });
  expect(result.statusCode).toBe(200);
  expect(result.json().items).toEqual([
    expect.objectContaining({ actor_id: null, actor_kind: "system", initiated_by: actor }),
  ]);
});

it("reads public Wallet broadcasts and restores only their immutable operation content (H28/H53)", async () => {
  const app = await getApp();
  const actor = await createUserWithCapabilities([CAPABILITIES.AUDIT_READ]);
  const operationId = randomUUID();
  const translations = { en: { title: "Public event notice", body: "Doors open at 09:00" } };
  await pool.query(
    "INSERT INTO wallet_operations(id,actor_id,request_key,kind,translations,is_test_account) VALUES ($1,$2,$3,'alert',$4,false)",
    [operationId, actor, randomUUID(), translations],
  );
  await audit(pool, {
    actorId: actor,
    entityType: "wallet_operation",
    entityId: operationId,
    action: "alert_queued",
    after: { kind: "alert", translations },
  });
  const stored = await pool.query(
    "SELECT after FROM audit_log WHERE entity_type='wallet_operation'",
  );
  expect(stored.rows[0].after.translations).toEqual(translations);
  await pool.query(
    "UPDATE audit_log SET after=jsonb_set(after,'{translations}','\"[private]\"'::jsonb) WHERE entity_type='wallet_operation'",
  );
  const listed = await app.inject({ method: "GET", url: "/api/audit", headers: asUser(actor) });
  expect(listed.statusCode).toBe(200);
  expect(listed.json().items[0].after.translations).toEqual(translations);
  const detail = await app.inject({
    method: "GET",
    url: `/api/audit/${listed.json().items[0].id}`,
    headers: asUser(actor),
  });
  expect(detail.json().after.translations).toEqual(translations);
});

it("captures public and restricted announcement audiences when their content changes (H50/H53)", async () => {
  const app = await getApp();
  const actor = await createUserWithCapabilities([
    CAPABILITIES.AUDIT_READ,
    CAPABILITIES.ANNOUNCEMENTS_MANAGE,
  ]);
  const recipient = await createUserWithCapabilities([]);
  const broadcast = await app.inject({
    method: "POST",
    url: "/api/announcements",
    headers: asUser(actor),
    payload: { title: "Public opening", body: "Doors open at 09:00" },
  });
  expect(broadcast.statusCode).toBe(201);
  const restricted = await app.inject({
    method: "POST",
    url: "/api/announcements",
    headers: asUser(actor),
    payload: { title: "PRIVATE recipient", body: "PRIVATE details", recipientUserIds: [recipient] },
  });
  expect(restricted.statusCode).toBe(201);
  const result = await app.inject({
    method: "GET",
    url: "/api/audit?entityType=announcement",
    headers: asUser(actor),
  });
  const rows = result.json().items;
  expect(
    rows.find((row: { entity_id: string }) => row.entity_id === String(broadcast.json().id)).after,
  ).toMatchObject({
    title: "Public opening",
    body: "Doors open at 09:00",
    audit_audience: "broadcast",
  });
  const privateRow = rows.find(
    (row: { entity_id: string }) => row.entity_id === String(restricted.json().id),
  );
  expect(privateRow.after).toMatchObject({
    title: "[private]",
    body: "[private]",
    audit_audience: "restricted",
  });
  expect(JSON.stringify(privateRow)).not.toContain("PRIVATE");
  const deleted = await app.inject({
    method: "DELETE",
    url: `/api/announcements/${restricted.json().id}`,
    headers: asUser(actor),
  });
  expect(deleted.statusCode).toBe(200);
  const deletion = await pool.query(
    "SELECT before FROM audit_log WHERE entity_type='announcement' AND action='delete'",
  );
  expect(deletion.rows[0].before).toMatchObject({
    title: "[private]",
    audit_audience: "restricted",
  });
});

it("does not combine stale private content with a newer public audience (H50/H53)", async () => {
  const app = await getApp();
  const actor = await createUserWithCapabilities([CAPABILITIES.ANNOUNCEMENTS_MANAGE]);
  const recipient = await createUserWithCapabilities([]);
  const created = await app.inject({
    method: "POST",
    url: "/api/announcements",
    headers: asUser(actor),
    payload: {
      title: "PRIVATE old title",
      body: "PRIVATE old body",
      recipientUserIds: [recipient],
    },
  });
  expect(created.statusCode).toBe(201);
  const { rows } = await pool.query<Announcement>("SELECT * FROM announcements WHERE id=$1", [
    created.json().id,
  ]);
  const stale = rows[0];
  expect(stale).toBeDefined();
  if (!stale) throw new Error("Missing announcement fixture");
  await pool.query(
    "UPDATE announcements SET title='Public updated notice', body='Public updated body' WHERE id=$1",
    [stale.id],
  );
  await pool.query("DELETE FROM announcement_recipients WHERE announcement_id=$1", [stale.id]);
  const snapshot = await withTransaction((client) => announcementAuditSnapshot(client, stale));
  expect(snapshot).toMatchObject({
    title: "Public updated notice",
    body: "Public updated body",
    audit_audience: "broadcast",
  });
  expect(JSON.stringify(snapshot)).not.toContain("PRIVATE");
});

it("stores and returns badge/email evidence without exposing notes or secrets (H53)", async () => {
  const app = await getApp();
  const actor = await createUserWithCapabilities([CAPABILITIES.AUDIT_READ]);
  await audit(pool, {
    actorId: actor,
    entityType: "user",
    entityId: actor,
    action: "primary_email_changed",
    before: { email: "old@example.test", badgeId: "BADGE-OLD" },
    after: { email: "new@example.test", badgeId: "BADGE-NEW", notes: "PRIVATE", token: "SECRET" },
  });
  const stored = await pool.query("SELECT * FROM audit_log ORDER BY id DESC LIMIT 1");
  expect(stored.rows[0].before).toEqual({ email: "old@example.test", badgeId: "BADGE-OLD" });
  const detail = await app.inject({
    method: "GET",
    url: `/api/audit/${stored.rows[0].id}`,
    headers: asUser(actor),
  });
  expect(detail.statusCode).toBe(200);
  expect(detail.json().after).toEqual({
    email: "new@example.test",
    badgeId: "BADGE-NEW",
    notes: "[private]",
    token: "[private]",
  });
  expect(JSON.stringify(stored.rows)).not.toContain("PRIVATE");
  expect(JSON.stringify(stored.rows)).not.toContain("SECRET");
});

it("presents legacy automatic exits as System in list and detail without guessing manual actions (H53)", async () => {
  const app = await getApp();
  const actor = await createUserWithCapabilities([CAPABILITIES.AUDIT_READ]);
  const legacy = await pool.query(
    "INSERT INTO audit_log(entity_type,entity_id,action,source) VALUES ('presence','42','event_end_auto_exit','web') RETURNING id",
  );
  const list = await app.inject({ method: "GET", url: "/api/audit", headers: asUser(actor) });
  expect(list.json().items[0]).toMatchObject({
    actor_id: null,
    actor_kind: "system",
    source: "system",
  });
  const detail = await app.inject({
    method: "GET",
    url: `/api/audit/${legacy.rows[0].id}`,
    headers: asUser(actor),
  });
  expect(detail.json()).toMatchObject({ actor_id: null, actor_kind: "system", source: "system" });
  await runWithRequestContext({ getActorId: () => actor }, () =>
    auditMany(pool, [
      {
        actorId: null,
        entityType: "presence",
        entityId: 43,
        action: "event_end_auto_exit",
        source: "web",
      },
    ]),
  );
  const written = await pool.query(
    "SELECT actor_id,actor_kind,source,initiated_by FROM audit_log WHERE entity_id='43'",
  );
  expect(written.rows).toEqual([
    { actor_id: null, actor_kind: "system", source: "system", initiated_by: actor },
  ]);
});

it("labels catalogue subjects by their current name (H53, H54)", async () => {
  const app = await getApp();
  const actor = await createUserWithCapabilities([CAPABILITIES.AUDIT_READ]);
  const university = await pool.query<{ id: number }>(
    "INSERT INTO universities(name) VALUES ('Universidade da Coruña') RETURNING id",
  );
  const id = university.rows[0]!.id;
  await audit(pool, {
    actorId: actor,
    entityType: "university",
    entityId: id,
    action: "created",
    after: { name: "Universidade da Coruña" },
  });
  await audit(pool, {
    actorId: actor,
    entityType: "university",
    entityId: 999999,
    action: "deleted",
  });

  const list = await app.inject({
    method: "GET",
    url: "/api/audit?entityType=university",
    headers: asUser(actor),
  });
  expect(list.statusCode).toBe(200);
  const labels = Object.fromEntries(
    list
      .json()
      .items.map((row: { entity_id: string; entity_label: string | null }) => [
        row.entity_id,
        row.entity_label,
      ]),
  );
  expect(labels).toEqual({ [String(id)]: "Universidade da Coruña", "999999": null });

  const created = list
    .json()
    .items.find((row: { entity_id: string }) => row.entity_id === String(id));
  const detail = await app.inject({
    method: "GET",
    url: `/api/audit/${created.id}`,
    headers: asUser(actor),
  });
  expect(detail.json().entity_label).toBe("Universidade da Coruña");
});
