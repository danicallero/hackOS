import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { beforeEach, describe, expect, it } from "vitest";
import { pool } from "../../src/db/pool.js";
import { findDuplicateCandidates } from "../../src/modules/applications/duplicate-detection.js";
import { asUser, createUser, createUserWithCapabilities, useTestApp } from "../helpers.js";
import { createApplication, sampleTemplate } from "./fixtures.js";

/** H13/H54: duplicate applications — detection, reviewer decisions and the applicant's answer. */

const getApp = useTestApp();
let reviewer: number;
let editor: number;

beforeEach(async () => {
  reviewer = await createUserWithCapabilities([CAPABILITIES.APPLICATIONS_REVIEW]);
  editor = await createUserWithCapabilities([
    CAPABILITIES.APPLICATIONS_REVIEW,
    CAPABILITIES.APPLICATIONS_EDIT_RESPONSE,
  ]);
});

function templateWithDni() {
  return [
    ...sampleTemplate(),
    {
      key: "dni",
      label: { en: "ID", es: "DNI", gl: "DNI" },
      kind: "text" as const,
      required: false,
    },
  ];
}

async function applicant(
  appId: number,
  person: { name: string; surname: string; email: string },
  responses: Record<string, unknown>,
  submit = true,
): Promise<{ userId: number; responseId: number }> {
  const a = await getApp();
  const userId = await createUser({ email: person.email, name: person.name });
  await pool.query(`UPDATE users SET surname = $2 WHERE id = $1`, [userId, person.surname]);
  const saved = await a.inject({
    method: "PUT",
    url: `/api/applications/${appId}/response`,
    headers: asUser(userId),
    payload: { responses },
  });
  expect(saved.statusCode).toBe(200);
  if (submit) {
    const submitted = await a.inject({
      method: "POST",
      url: `/api/applications/${appId}/response/submit`,
      headers: asUser(userId),
      payload: { food_intolerances: [], shirt_size: "M" },
    });
    expect(submitted.statusCode).toBe(200);
  }
  const { rows } = await pool.query(
    `SELECT id FROM application_responses WHERE user_id = $1 AND application_id = $2`,
    [userId, appId],
  );
  return { userId, responseId: rows[0].id };
}

async function duplicatePair(appId: number) {
  const first = await applicant(
    appId,
    { name: "Lucía", surname: "Fernández Rey", email: "lucia.fernandez@example.test" },
    { motivation: "first", credits: "yes", dni: "12345678-Z" },
  );
  const second = await applicant(
    appId,
    { name: "Lucia", surname: "Fernandez", email: "luciafernandez99@example.org" },
    { motivation: "second", dni: "12345678z" },
  );
  return { first, second };
}

async function overview(appId: number, userId = reviewer) {
  const a = await getApp();
  const res = await a.inject({
    method: "GET",
    url: `/api/applications/${appId}/duplicates`,
    headers: asUser(userId),
  });
  expect(res.statusCode).toBe(200);
  return res.json();
}

async function propose(
  appId: number,
  pair: [number, number],
  submittedFrom: number,
  fieldSources: Record<string, number> = {},
) {
  const a = await getApp();
  return a.inject({
    method: "POST",
    url: `/api/applications/${appId}/duplicates/merges`,
    headers: { ...asUser(editor), "Idempotency-Key": crypto.randomUUID() },
    payload: {
      response_ids: pair,
      field_sources: fieldSources,
      submitted_from_response_id: submittedFrom,
    },
  });
}

/** The raw token of each emailed link, keyed by recipient user id. */
async function mergeTokens(template = "application.duplicate"): Promise<Map<number, string>> {
  const { rows } = await pool.query(
    `SELECT user_id, payload FROM notification_outbox
      WHERE payload->>'template' = $1 ORDER BY id`,
    [template],
  );
  return new Map(
    rows.map((row) => [
      row.user_id as number,
      String(row.payload.vars.mergeUrl).split("#token=")[1] ?? "",
    ]),
  );
}

async function decide(token: string, payload: Record<string, unknown>, key = crypto.randomUUID()) {
  const a = await getApp();
  return a.inject({
    method: "POST",
    url: "/api/applications/duplicate-merges/decide",
    headers: { "Idempotency-Key": key },
    payload: { token, ...payload },
  });
}

describe("masked addresses (H13, H15)", () => {
  it("masks a personal domain but keeps a shared provider recognizable", async () => {
    const { maskEmail } = await import("../../src/modules/applications/confirmations.js");
    expect(maskEmail("ana@gmail.com")).toBe("a•••@gmail.com");
    expect(maskEmail("anagarcia22@gmail.com")).toBe("anag•••2@gmail.com");
    expect(maskEmail("me@firstlastname.com")).toBe("m•••@fir•••.com");
    expect(maskEmail("ana@cs.example.co")).toBe("a•••@cs.•••.co");
  });
});

describe("duplicate detection scoring (H13)", () => {
  it("flags a shared DNI, similar names and similar emails, and nothing for strangers", () => {
    const candidates = findDuplicateCandidates([
      {
        responseId: 1,
        name: "Ana",
        surname: "Pérez García",
        email: "anaperez@x.test",
        dnis: ["11111111H"],
      },
      {
        responseId: 2,
        name: "ana",
        surname: "perez",
        email: "ana.perez+hack@y.test",
        dnis: [null],
      },
      {
        responseId: 3,
        name: "Bruno",
        surname: "Souto",
        email: "bsouto@x.test",
        dnis: ["11.111.111-h"],
      },
      { responseId: 4, name: "Carmen", surname: "Vidal", email: "cvidal@x.test", dnis: [] },
    ]);
    const byPair = new Map(
      candidates.map((c) => [`${c.firstResponseId}:${c.secondResponseId}`, c.reasons]),
    );
    expect(byPair.get("1:2")).toEqual(["name", "email"]);
    expect(byPair.get("1:3")).toEqual(["dni"]);
    expect([...byPair.keys()].some((key) => key.includes("4"))).toBe(false);
    // A shared DNI ranks first.
    expect(candidates[0]?.reasons).toContain("dni");
  });
});

describe("duplicate applications (H13, H54)", () => {
  it("suggests a pair, hides it once dismissed, and suggests it again when the dismissal is undone", async () => {
    const a = await getApp();
    const appId = await createApplication({ template: templateWithDni() });
    const { first, second } = await duplicatePair(appId);
    await applicant(
      appId,
      { name: "Xoán", surname: "Otero", email: "xotero@example.test" },
      { motivation: "unrelated" },
    );

    const listed = await overview(appId);
    expect(listed.candidates).toHaveLength(1);
    expect(listed.candidates[0]).toMatchObject({
      first_response_id: first.responseId,
      second_response_id: second.responseId,
    });
    expect(listed.candidates[0].reasons).toEqual(expect.arrayContaining(["dni", "name"]));

    const dismissed = await a.inject({
      method: "POST",
      url: `/api/applications/${appId}/duplicates/dismiss`,
      headers: { ...asUser(reviewer), "Idempotency-Key": crypto.randomUUID() },
      payload: { response_ids: [second.responseId, first.responseId] },
    });
    expect(dismissed.statusCode).toBe(200);
    const after = await overview(appId);
    expect(after.candidates).toHaveLength(0);
    expect(after.cases[0]).toMatchObject({ status: "dismissed" });

    const again = await a.inject({
      method: "POST",
      url: `/api/applications/${appId}/duplicates/dismiss`,
      headers: { ...asUser(reviewer), "Idempotency-Key": crypto.randomUUID() },
      payload: { response_ids: [first.responseId, second.responseId] },
    });
    expect(again.statusCode).toBe(409);

    const undone = await a.inject({
      method: "POST",
      url: `/api/applications/${appId}/duplicates/${after.cases[0].id}/cancel`,
      headers: { ...asUser(reviewer), "Idempotency-Key": crypto.randomUUID() },
    });
    expect(undone.statusCode).toBe(200);
    expect((await overview(appId)).candidates).toHaveLength(1);

    const { rows: audits } = await pool.query(
      `SELECT action FROM audit_log WHERE entity_type = 'application_duplicate_case' ORDER BY id`,
    );
    expect(audits.map((row) => row.action)).toEqual(["dismissed", "cancelled"]);
  });

  it("needs the edit-response capability to propose a merge", async () => {
    const a = await getApp();
    const appId = await createApplication({ template: templateWithDni() });
    const { first, second } = await duplicatePair(appId);
    const res = await a.inject({
      method: "POST",
      url: `/api/applications/${appId}/duplicates/merges`,
      headers: { ...asUser(reviewer), "Idempotency-Key": crypto.randomUUID() },
      payload: {
        response_ids: [first.responseId, second.responseId],
        submitted_from_response_id: first.responseId,
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it("merges into the account the applicant keeps and deletes the other one", async () => {
    const a = await getApp();
    const appId = await createApplication({ template: templateWithDni() });
    const { first, second } = await duplicatePair(appId);
    const { rows: before } = await pool.query(
      `SELECT id, submitted_at FROM application_responses WHERE id = ANY($1::int[]) ORDER BY id`,
      [[first.responseId, second.responseId]],
    );

    // Motivation from the second response, the rest by default; first's submission date.
    const proposed = await propose(appId, [first.responseId, second.responseId], first.responseId, {
      motivation: second.responseId,
    });
    expect(proposed.statusCode).toBe(200);
    expect((await overview(appId)).candidates).toHaveLength(0);

    const tokens = await mergeTokens();
    expect([...tokens.keys()].sort()).toEqual([first.userId, second.userId].sort());
    const firstToken = tokens.get(first.userId) as string;

    const lookup = await a.inject({
      method: "POST",
      url: "/api/applications/duplicate-merges/lookup",
      payload: { token: firstToken },
    });
    expect(lookup.statusCode).toBe(200);
    const view = lookup.json();
    expect(view.you).toBe("first");
    expect(view.accounts).toEqual([
      { side: "first", email: "lucia.fernandez@example.test" },
      { side: "second", email: "luci•••9@exa•••.org" },
    ]);
    expect(view.answers).toMatchObject({ motivation: "second", credits: "yes", dni: "12345678-Z" });

    const key = crypto.randomUUID();
    const merged = await decide(firstToken, { decision: "merge", keep: "second" }, key);
    expect(merged.statusCode).toBe(200);
    expect(merged.json()).toEqual({ status: "merged" });
    const replay = await decide(firstToken, { decision: "merge", keep: "second" }, key);
    expect(replay.statusCode).toBe(200);

    const { rows: kept } = await pool.query(
      `SELECT responses, status, submitted_at FROM application_responses WHERE id = $1`,
      [second.responseId],
    );
    expect(kept[0].responses).toMatchObject({ motivation: "second", credits: "yes" });
    expect(kept[0].status).toBe("review");
    expect(kept[0].submitted_at.toISOString()).toBe(before[0].submitted_at.toISOString());
    const { rows: gone } = await pool.query(
      `SELECT (SELECT count(*) FROM application_responses WHERE id = $1)::int AS responses,
              (SELECT count(*) FROM users WHERE id = $2)::int AS users`,
      [first.responseId, first.userId],
    );
    expect(gone[0]).toEqual({ responses: 0, users: 0 });
    const { rows: user } = await pool.query(`SELECT dni FROM users WHERE id = $1`, [second.userId]);
    expect(user[0].dni).toBe("12345678-Z");

    const { cases } = await overview(appId);
    expect(cases[0]).toMatchObject({ status: "merged", kept_response_id: second.responseId });

    // The other link can no longer answer.
    const late = await decide(tokens.get(second.userId) as string, { decision: "keep_separate" });
    expect(late.statusCode).toBe(409);
    expect(late.json().error.details.code).toBe("duplicate_merge_closed");
  });

  it("keeps both applications when the applicant says they are different people", async () => {
    const appId = await createApplication({ template: templateWithDni() });
    const { first, second } = await duplicatePair(appId);
    expect(
      (await propose(appId, [first.responseId, second.responseId], first.responseId)).statusCode,
    ).toBe(200);
    const token = (await mergeTokens()).get(second.userId) as string;

    const res = await decide(token, { decision: "keep_separate" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "kept_separate" });
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM application_responses WHERE application_id = $1`,
      [appId],
    );
    expect(rows[0].n).toBe(2);
    const listed = await overview(appId);
    expect(listed.candidates).toHaveLength(0);
    expect(listed.cases[0]).toMatchObject({ status: "kept_separate" });
    const { rows: stored } = await pool.query(
      `SELECT merged_responses FROM application_duplicate_cases WHERE id = $1`,
      [listed.cases[0].id],
    );
    expect(stored[0].merged_responses).toBeNull();
  });

  it("refuses an outdated proposal and responses that already have a decision", async () => {
    const a = await getApp();
    const appId = await createApplication({ template: templateWithDni() });
    const { first, second } = await duplicatePair(appId);
    expect(
      (await propose(appId, [first.responseId, second.responseId], first.responseId)).statusCode,
    ).toBe(200);
    await pool.query(
      `UPDATE application_responses SET responses = responses || '{"motivation":"changed"}' WHERE id = $1`,
      [second.responseId],
    );
    expect((await overview(appId)).cases[0].outdated).toBe(true);
    const token = (await mergeTokens()).get(first.userId) as string;
    const res = await decide(token, { decision: "merge", keep: "first" });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.details.code).toBe("duplicate_merge_outdated");

    const cancel = await a.inject({
      method: "POST",
      url: `/api/applications/${appId}/duplicates/${(await overview(appId)).cases[0].id}/cancel`,
      headers: { ...asUser(editor), "Idempotency-Key": crypto.randomUUID() },
    });
    expect(cancel.statusCode).toBe(200);

    await pool.query(
      `UPDATE application_responses SET status = 'accepted_internal' WHERE id = $1`,
      [first.responseId],
    );
    const decided = await propose(appId, [first.responseId, second.responseId], first.responseId);
    expect(decided.statusCode).toBe(409);
    expect(decided.json().error.details.code).toBe("duplicate_merge_decided");
  });

  it("requires a submitted response's date when either was submitted", async () => {
    const appId = await createApplication({ template: templateWithDni() });
    const first = await applicant(
      appId,
      { name: "Iria", surname: "Lago", email: "iria.lago@example.test" },
      { motivation: "a" },
    );
    const draft = await applicant(
      appId,
      { name: "Iria", surname: "Lago", email: "irialago@example.org" },
      { motivation: "b" },
      false,
    );
    const res = await propose(appId, [first.responseId, draft.responseId], draft.responseId);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.details.code).toBe("duplicate_merge_submission_required");
  });

  it("keeps a file chosen from the deleted account under the kept account", async () => {
    const { objectExists, putObject } = await import("../../src/lib/storage.js");
    const template = [
      ...templateWithDni(),
      {
        key: "cv",
        label: { en: "CV", es: "CV", gl: "CV" },
        kind: "file" as const,
        required: false,
      },
    ];
    const appId = await createApplication({ template });
    const { first, second } = await duplicatePair(appId);
    const cvKey = `uploads/${appId}/${first.userId}/cv/op/cv.pdf`;
    await putObject(cvKey, Buffer.from("%PDF-1.4"), "application/pdf");
    await pool.query(
      `UPDATE application_responses SET responses = responses || jsonb_build_object('cv', $2::text) WHERE id = $1`,
      [first.responseId, cvKey],
    );
    expect(
      (await propose(appId, [first.responseId, second.responseId], first.responseId)).statusCode,
    ).toBe(200);
    const token = (await mergeTokens()).get(second.userId) as string;
    const res = await decide(token, { decision: "merge", keep: "second" });
    expect(res.statusCode).toBe(200);
    const { rows } = await pool.query(`SELECT responses FROM application_responses WHERE id = $1`, [
      second.responseId,
    ]);
    const copied = rows[0].responses.cv as string;
    expect(copied.startsWith(`uploads/${appId}/${second.userId}/cv/`)).toBe(true);
    expect(await objectExists(copied)).toBe(true);
  });

  it("lets exactly one of two simultaneous answers win", async () => {
    const appId = await createApplication({ template: templateWithDni() });
    const { first, second } = await duplicatePair(appId);
    expect(
      (await propose(appId, [first.responseId, second.responseId], first.responseId)).statusCode,
    ).toBe(200);
    const tokens = await mergeTokens();
    const results = await Promise.all([
      decide(tokens.get(first.userId) as string, { decision: "merge", keep: "first" }),
      decide(tokens.get(second.userId) as string, { decision: "keep_separate" }),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    const { rows } = await pool.query(
      `SELECT status FROM application_duplicate_cases WHERE application_id = $1`,
      [appId],
    );
    expect(["merged", "kept_separate"]).toContain(rows[0].status);
  });

  it("asks to delete the account whose application was not accepted (H13, H54)", async () => {
    const a = await getApp();
    const appId = await createApplication({ template: templateWithDni() });
    const { first, second } = await duplicatePair(appId);
    await pool.query(`UPDATE application_responses SET status = 'accepted' WHERE id = $1`, [
      first.responseId,
    ]);
    const pair = [first.responseId, second.responseId] as [number, number];
    const merge = await propose(appId, pair, first.responseId);
    expect(merge.json().error.details.code).toBe("duplicate_merge_decided");

    const removal = await a.inject({
      method: "POST",
      url: `/api/applications/${appId}/duplicates/removals`,
      headers: { ...asUser(editor), "Idempotency-Key": crypto.randomUUID() },
      payload: { response_ids: pair },
    });
    expect(removal.statusCode).toBe(200);
    const { rows: mails } = await pool.query(
      `SELECT user_id, payload->'vars' AS vars FROM notification_outbox
        WHERE payload->>'template' = 'application.duplicate_removal' ORDER BY user_id`,
    );
    const toSecond = mails.find((row) => row.user_id === second.userId);
    expect(toSecond.vars).toMatchObject({
      keptEmail: "luci•••z@exa•••.test",
      removedEmail: "luciafernandez99@example.org",
    });
    const { cases } = await overview(appId);
    expect(cases[0]).toMatchObject({ kind: "remove", status: "pending", outdated: false });

    // The accepted applicant confirming attendance does not outdate the proposal.
    await pool.query(`UPDATE application_responses SET status = 'confirmed' WHERE id = $1`, [
      first.responseId,
    ]);
    const token = (await mergeTokens("application.duplicate_removal")).get(second.userId) as string;
    const lookup = await a.inject({
      method: "POST",
      url: "/api/applications/duplicate-merges/lookup",
      payload: { token },
    });
    expect(lookup.statusCode).toBe(200);
    expect(lookup.json()).toMatchObject({
      kind: "remove",
      you: "second",
      kept: "first",
      answers: {},
    });

    const wrong = await decide(token, { decision: "merge", keep: "second" });
    expect(wrong.statusCode).toBe(400);
    const res = await decide(token, { decision: "remove" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "removed" });

    const { rows } = await pool.query(
      `SELECT (SELECT status FROM application_responses WHERE id = $1) AS kept,
              (SELECT count(*) FROM application_responses WHERE id = $2)::int AS responses,
              (SELECT count(*) FROM users WHERE id = $3)::int AS users`,
      [first.responseId, second.responseId, second.userId],
    );
    expect(rows[0]).toEqual({ kept: "confirmed", responses: 0, users: 0 });
    expect((await overview(appId)).cases[0]).toMatchObject({
      status: "removed",
      kept_response_id: first.responseId,
    });
  });

  it("only proposes a removal with exactly one accepted application, and outdates it", async () => {
    const a = await getApp();
    const appId = await createApplication({ template: templateWithDni() });
    const { first, second } = await duplicatePair(appId);
    const pair = [first.responseId, second.responseId] as [number, number];
    const proposeRemoval = () =>
      a.inject({
        method: "POST",
        url: `/api/applications/${appId}/duplicates/removals`,
        headers: { ...asUser(editor), "Idempotency-Key": crypto.randomUUID() },
        payload: { response_ids: pair },
      });
    const none = await proposeRemoval();
    expect(none.statusCode).toBe(409);
    expect(none.json().error.details.code).toBe("duplicate_removal_not_applicable");

    await pool.query(`UPDATE application_responses SET status = 'confirmed' WHERE id = $1`, [
      second.responseId,
    ]);
    expect((await proposeRemoval()).statusCode).toBe(200);
    // The kept application stops being accepted: the answer is refused.
    await pool.query(`UPDATE application_responses SET status = 'declined' WHERE id = $1`, [
      second.responseId,
    ]);
    expect((await overview(appId)).cases[0].outdated).toBe(true);
    const token = (await mergeTokens("application.duplicate_removal")).get(first.userId) as string;
    const res = await decide(token, { decision: "remove" });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.details.code).toBe("duplicate_merge_outdated");
  });

  it("lets the applicant choose the account when both are accepted with the same DNI", async () => {
    const a = await getApp();
    const appId = await createApplication({ template: templateWithDni() });
    const { first, second } = await duplicatePair(appId);
    await pool.query(`UPDATE application_responses SET status = 'confirmed' WHERE id = ANY($1)`, [
      [first.responseId, second.responseId],
    ]);
    const proposeRemoval = () =>
      a.inject({
        method: "POST",
        url: `/api/applications/${appId}/duplicates/removals`,
        headers: { ...asUser(editor), "Idempotency-Key": crypto.randomUUID() },
        payload: { response_ids: [first.responseId, second.responseId] },
      });

    // Without a shared DNI two accepted applications are left alone.
    await pool.query(
      `UPDATE application_responses SET responses = responses || '{"dni":"99999999R"}' WHERE id = $1`,
      [second.responseId],
    );
    await pool.query(`UPDATE users SET dni = '99999999R' WHERE id = $1`, [second.userId]);
    const different = await proposeRemoval();
    expect(different.statusCode).toBe(409);
    expect(different.json().error.details.code).toBe("duplicate_removal_not_applicable");
    await pool.query(
      `UPDATE application_responses SET responses = responses || '{"dni":"12345678z"}' WHERE id = $1`,
      [second.responseId],
    );

    expect((await proposeRemoval()).statusCode).toBe(200);
    const token = (await mergeTokens("application.duplicate_choice")).get(first.userId) as string;
    const lookup = await a.inject({
      method: "POST",
      url: "/api/applications/duplicate-merges/lookup",
      payload: { token },
    });
    expect(lookup.json()).toMatchObject({ kind: "remove", you: "first", kept: null });

    expect((await decide(token, { decision: "remove" })).statusCode).toBe(400);
    const res = await decide(token, { decision: "remove", keep: "second" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "removed" });
    const { rows } = await pool.query(
      `SELECT (SELECT status FROM application_responses WHERE id = $1) AS kept,
              (SELECT count(*) FROM users WHERE id = $2)::int AS users`,
      [second.responseId, first.userId],
    );
    expect(rows[0]).toEqual({ kept: "confirmed", users: 0 });
  });
});
