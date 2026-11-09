import "./env.js";
import { randomUUID } from "node:crypto";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { expect, it } from "vitest";
import { pool } from "../../src/db/pool.js";
import { asUser, createUser, createUserWithCapabilities, useTestApp } from "../helpers.js";
import { createApplication, createResponse } from "./fixtures.js";

const getApp = useTestApp();

// H13/H53: preserve accountability without private review history or autosave noise.
it("groups review autosaves per actor, response and session without retaining notes", async () => {
  const app = await getApp();
  const author = await createUserWithCapabilities([CAPABILITIES.APPLICATIONS_REVIEW]);
  const other = await createUserWithCapabilities([CAPABILITIES.APPLICATIONS_REVIEW]);
  const applicant = await createUser({ emailVerified: true });
  const application = await createApplication();
  const response = await createResponse(applicant, application, { status: "review" });
  const session = randomUUID();
  async function save(actor: number, score: number, notes: string, editSession = session) {
    const result = await app.inject({
      method: "PUT",
      url: `/api/responses/${response}/my-review`,
      headers: asUser(actor),
      payload: { score, notes, edit_session_id: editSession },
    });
    expect(result.statusCode).toBe(200);
  }
  await save(author, 2, "PRIVATE first");
  await save(author, 3, "PRIVATE final");
  await save(author, 3, "PRIVATE final");
  let result = await pool.query(
    "SELECT * FROM audit_log WHERE action = 'review_scored' ORDER BY id",
  );
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0].before).toEqual({ score: null });
  expect(result.rows[0].after.score).toBe(3);
  expect(result.rows[0].after.changed_fields.sort()).toEqual(["notes", "score"]);
  expect(JSON.stringify(result.rows)).not.toContain("PRIVATE");
  await save(other, 4, "PRIVATE other");
  await save(author, 4, "PRIVATE later", randomUUID());
  result = await pool.query("SELECT * FROM audit_log WHERE action = 'review_scored'");
  expect(result.rows).toHaveLength(3);
  expect(JSON.stringify(result.rows)).not.toContain("PRIVATE");
  const stored = await pool.query(
    "SELECT notes FROM applicant_reviews WHERE response_id=$1 AND author_id=$2",
    [response, author],
  );
  expect(stored.rows[0].notes).toBe("PRIVATE later");
});
