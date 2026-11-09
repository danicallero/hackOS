import { randomUUID } from "node:crypto";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { expect, it } from "vitest";
import { pool } from "../../src/db/pool.js";
import { audit, auditMany } from "../../src/lib/audit.js";
import { runWithRequestContext } from "../../src/lib/request-context.js";
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
