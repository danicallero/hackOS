import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { processDataSubjectRequest } from "../../src/modules/exports/worker.js";
import {
  asUser,
  buildTestApp,
  createUser,
  createUserWithCapabilities,
  truncateAll,
} from "../helpers.js";

/** H54 staff workflow: creating and tracking export/deletion requests. */

let app: App;

beforeEach(async () => {
  await truncateAll();
  const { valkey } = await import("../../src/lib/valkey.js");
  await valkey.flushdb();
  app ??= await buildTestApp();
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

describe("POST /api/exports/requests (H54)", () => {
  it("creates an export request, processes it, and exposes completed status + download availability", async () => {
    const staff = await createUserWithCapabilities([CAPABILITIES.EXPORTS_RUN]);
    const subject = await createUser({ email: "subject@example.test" });

    const created = await app.inject({
      method: "POST",
      url: "/api/exports/requests",
      headers: asUser(staff),
      payload: { subjectUserId: subject, type: "export" },
    });
    expect(created.statusCode).toBe(201);
    const body = created.json();
    expect(body.status).toBe("pending");
    expect(body.downloadAvailable).toBe(false);

    await processDataSubjectRequest(body.id);

    const after = await app.inject({
      method: "GET",
      url: `/api/exports/requests/${body.id}`,
      headers: asUser(staff),
    });
    expect(after.statusCode).toBe(200);
    expect(after.json().status).toBe("completed");
    expect(after.json().downloadAvailable).toBe(true);
  });

  it("403s without exports:run", async () => {
    const noCaps = await createUser();
    const subject = await createUser();
    const res = await app.inject({
      method: "POST",
      url: "/api/exports/requests",
      headers: asUser(noCaps),
      payload: { subjectUserId: subject, type: "export" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("400s when the subject is the requester themself", async () => {
    const staff = await createUserWithCapabilities([CAPABILITIES.EXPORTS_RUN]);
    const res = await app.inject({
      method: "POST",
      url: "/api/exports/requests",
      headers: asUser(staff),
      payload: { subjectUserId: staff, type: "export" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("409s a second in-flight request of the same type for the same subject", async () => {
    const staff = await createUserWithCapabilities([CAPABILITIES.EXPORTS_RUN]);
    const subject = await createUser();
    const first = await app.inject({
      method: "POST",
      url: "/api/exports/requests",
      headers: asUser(staff),
      payload: { subjectUserId: subject, type: "export" },
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: "POST",
      url: "/api/exports/requests",
      headers: asUser(staff),
      payload: { subjectUserId: subject, type: "export" },
    });
    expect(second.statusCode).toBe(409);
  });

  it("replays the same response for a repeated Idempotency-Key + body, 409s on a mismatched body", async () => {
    const staff = await createUserWithCapabilities([CAPABILITIES.EXPORTS_RUN]);
    const subjectA = await createUser();
    const subjectB = await createUser();
    const key = crypto.randomUUID();

    const first = await app.inject({
      method: "POST",
      url: "/api/exports/requests",
      headers: { ...asUser(staff), "idempotency-key": key },
      payload: { subjectUserId: subjectA, type: "export" },
    });
    expect(first.statusCode).toBe(201);

    const replay = await app.inject({
      method: "POST",
      url: "/api/exports/requests",
      headers: { ...asUser(staff), "idempotency-key": key },
      payload: { subjectUserId: subjectA, type: "export" },
    });
    expect(replay.statusCode).toBe(201);
    expect(replay.json().id).toBe(first.json().id);
    expect(replay.headers["idempotency-replayed"]).toBe("true");

    const mismatched = await app.inject({
      method: "POST",
      url: "/api/exports/requests",
      headers: { ...asUser(staff), "idempotency-key": key },
      payload: { subjectUserId: subjectB, type: "export" },
    });
    expect(mismatched.statusCode).toBe(409);
  });

  it("lists requests filtered by subject and status", async () => {
    const staff = await createUserWithCapabilities([CAPABILITIES.EXPORTS_RUN]);
    const subject = await createUser();
    const created = await app.inject({
      method: "POST",
      url: "/api/exports/requests",
      headers: asUser(staff),
      payload: { subjectUserId: subject, type: "export" },
    });

    const list = await app.inject({
      method: "GET",
      url: `/api/exports/requests?subjectUserId=${subject}&status=pending`,
      headers: asUser(staff),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().total).toBe(1);
    expect(list.json().items[0].id).toBe(created.json().id);
  });
});
