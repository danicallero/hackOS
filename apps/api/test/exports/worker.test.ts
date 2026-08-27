import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createUser, createUserWithCapabilities, truncateAll } from "../helpers.js";
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

  it("leaves an in-venue deletion request processing until the participant exits", async () => {
    const { pool } = await import("../../src/db/pool.js");
    const { processDataSubjectRequest } = await import("../../src/modules/exports/worker.js");
    const { presenceScan } = await import("../../src/modules/logistics/presence.js");

    const admin = await createUserWithCapabilities(["*"]);
    const scanner = await createUserWithCapabilities([CAPABILITIES.PRESENCE_SCAN]);
    const subject = await createUser({ name: "Pending DSR subject" });
    await pool.query(`UPDATE users SET badge_id = 'DSR-PENDING-BADGE' WHERE id = $1`, [subject]);
    await pool.query(
      `INSERT INTO check_in_logs (user_id, badge_id, staff_id)
       VALUES ($1, 'DSR-PENDING-BADGE', $2)`,
      [subject, scanner],
    );
    await pool.query(
      `INSERT INTO time_logs (user_id, kind, scanned_at)
       VALUES ($1, 'in', now() - interval '5 minutes')`,
      [subject],
    );
    const { rows: applications } = await pool.query(
      `INSERT INTO applications (name, type, template)
       VALUES ('Pending response mutation guard', 'participant', '[]'::jsonb) RETURNING id`,
    );
    const { rows: responses } = await pool.query(
      `INSERT INTO application_responses (user_id, application_id, status, responses)
       VALUES ($1, $2, 'accepted', '{}'::jsonb) RETURNING id`,
      [subject, applications[0].id],
    );
    const { rows } = await pool.query(
      `INSERT INTO data_subject_requests (subject_user_id, requested_by, type)
       VALUES ($1, $2, 'deletion') RETURNING id`,
      [subject, admin],
    );

    await processDataSubjectRequest(rows[0].id);

    expect(
      (await pool.query(`SELECT status FROM data_subject_requests WHERE id = $1`, [rows[0].id]))
        .rows[0].status,
    ).toBe("processing");
    expect(
      (await pool.query(`SELECT account_state FROM users WHERE id = $1`, [subject])).rows[0]
        .account_state,
    ).toBe("removal_pending");
    await expect(
      pool.query(`UPDATE application_responses SET staff_notes = 'late mutation' WHERE id = $1`, [
        responses[0].id,
      ]),
    ).rejects.toMatchObject({ code: "23514" });

    await presenceScan(scanner, { badgeId: "DSR-PENDING-BADGE", kind: "out" });

    expect(
      (await pool.query(`SELECT status FROM data_subject_requests WHERE id = $1`, [rows[0].id]))
        .rows[0].status,
    ).toBe("completed");
    expect((await pool.query(`SELECT 1 FROM users WHERE id = $1`, [subject])).rowCount).toBe(0);
  });
});
