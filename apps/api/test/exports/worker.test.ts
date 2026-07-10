import "./env.js";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createUser, truncateAll } from "../helpers.js";
import { broadcastCount } from "./fixtures.js";

/** H54: the data-subject-request worker's claim guard and failure handling. */

beforeEach(async () => {
  await truncateAll();
  const { valkey } = await import("../../src/lib/valkey.js");
  await valkey.flushdb();
});

afterAll(async () => {
  const { stopQueues } = await import("../../src/lib/queues.js");
  const { closeValkey } = await import("../../src/lib/valkey.js");
  const { pool } = await import("../../src/db/pool.js");
  await stopQueues();
  await closeValkey();
  await pool.end();
});

describe("processDataSubjectRequest (H54)", () => {
  it("is a no-op when the request has already been completed (BullMQ redelivery safety)", async () => {
    const { pool } = await import("../../src/db/pool.js");
    const { processDataSubjectRequest } = await import("../../src/modules/exports/worker.js");

    const staff = await createUser();
    const subject = await createUser();
    const { rows } = await pool.query(
      `INSERT INTO data_subject_requests (subject_user_id, requested_by, type) VALUES ($1, $2, 'export') RETURNING id`,
      [subject, staff],
    );
    const requestId = rows[0].id;

    await processDataSubjectRequest(requestId);
    const { rows: afterFirst } = await pool.query(
      `SELECT status, storage_key FROM data_subject_requests WHERE id = $1`,
      [requestId],
    );
    expect(afterFirst[0].status).toBe("completed");
    const storageKeyAfterFirst = afterFirst[0].storage_key;

    const broadcastsBefore = await broadcastCount("exports");
    await processDataSubjectRequest(requestId);
    const broadcastsAfter = await broadcastCount("exports");
    expect(broadcastsAfter).toBe(broadcastsBefore); // no second completion broadcast

    const { rows: afterSecond } = await pool.query(
      `SELECT status, storage_key FROM data_subject_requests WHERE id = $1`,
      [requestId],
    );
    expect(afterSecond[0].storage_key).toBe(storageKeyAfterFirst);
  });

  it("marks the request failed and records the error when processing throws", async () => {
    const { pool } = await import("../../src/db/pool.js");
    const { processDataSubjectRequest } = await import("../../src/modules/exports/worker.js");

    // Bypass the service-level self-target guard by inserting directly, so
    // anonymizeUser's own actorId===targetId check fires inside the worker.
    const target = await createUser();
    const { rows } = await pool.query(
      `INSERT INTO data_subject_requests (subject_user_id, requested_by, type) VALUES ($1, $1, 'deletion') RETURNING id`,
      [target],
    );
    const requestId = rows[0].id;

    await processDataSubjectRequest(requestId);

    const { rows: after } = await pool.query(
      `SELECT status, error FROM data_subject_requests WHERE id = $1`,
      [requestId],
    );
    expect(after[0].status).toBe("failed");
    expect(after[0].error).toContain("anonymize your own account");
  });
});
