import { createHash, randomBytes } from "node:crypto";

import { sponsorShareKey } from "@hackos/shared/applications";
import { ERROR_REASONS } from "@hackos/shared/error-reasons";

import type pg from "pg";

import { pool, withTransaction } from "../../db/pool.js";

import { audit } from "../../lib/audit.js";

import { ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors.js";

import { getObject, putObject } from "../../lib/storage.js";

import { getEventName } from "../event/service.js";

import { getAccountRemovalEligibility, runAccountRemoval } from "../identity/removal.js";

import { webUrl } from "../identity/unverified-removal.js";

import type { EmailPayload } from "../notifications/templates.js";

import { maskEmail } from "./confirmations.js";

import { loadUserComms } from "./decision-delivery.js";

import {
  type DuplicateCandidate,
  findDuplicateCandidates,
  pairKey,
} from "./duplicate-detection.js";

import { extractDni, requireApplication } from "./forms.js";

import type { FormSection, TemplateField } from "./schemas.js";

/**
 * Duplicate applications (H13 review, H54 account removal). Reviewers see
 * pairs of responses that look like one person applying from two accounts,
 * dismiss the pair or propose a merge with answers chosen field by field. The
 * proposal is emailed to both addresses; the applicant keeps one account
 * (the other is deleted) or says they are different people.
 */

/** How long the emailed merge link stays valid. */
const PROPOSAL_DAYS = 14;

/** Only undecided responses can be merged: a decision belongs to one account. */
const MERGEABLE_STATUSES = new Set(["draft", "review"]);

/** Open cases hide their pair from the candidate list. */
const OPEN_STATUSES = ["dismissed", "pending", "kept_separate"];

const fingerprintSql = (alias: string) =>
  `md5(${alias}.responses::text || ${alias}.status::text || coalesce(${alias}.submitted_at::text, ''))`;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

type Side = "first" | "second";

interface DuplicateResponse {
  id: number;
  user_id: number;
  name: string | null;
  surname: string | null;
  email: string;
  status: string;
  submitted_at: Date | null;
  dni: string | null;
  responses: Record<string, unknown>;
}

interface CaseRow {
  id: number;
  application_id: number;
  first_response_id: number | null;
  second_response_id: number | null;
  status: string;
  merged_responses: Record<string, unknown> | null;
  submitted_from_response_id: number | null;
  source_fingerprints: Record<string, string> | null;
  first_token_hash: string | null;
  second_token_hash: string | null;
  expires_at: Date | null;
  kept_response_id: number | null;
  created_at: Date;
  resolved_at: Date | null;
}

// ── detection read ────────────────────────────────────────────────────────────

export interface DuplicateOverview {
  responses: Array<
    Omit<DuplicateResponse, "surname"> & { first_name: string | null; last_name: string | null }
  >;
  candidates: Array<{
    first_response_id: number;
    second_response_id: number;
    reasons: DuplicateCandidate["reasons"];
    name_similarity: number;
    email_similarity: number;
  }>;
  cases: Array<{
    id: number;
    status: string;
    first_response_id: number | null;
    second_response_id: number | null;
    kept_response_id: number | null;
    submitted_from_response_id: number | null;
    outdated: boolean;
    expires_at: Date | null;
    created_at: Date;
    resolved_at: Date | null;
  }>;
}

export async function getDuplicateOverview(applicationId: number): Promise<DuplicateOverview> {
  await requireApplication(pool, applicationId);
  const { rows: responses } = await pool.query<DuplicateResponse>(
    `SELECT r.id, r.user_id, u.name, u.surname, u.email, r.status, r.submitted_at,
            u.dni, r.responses
       FROM application_responses r
       JOIN users u ON u.id = r.user_id
      WHERE r.application_id = $1 AND u.account_state = 'active' AND u.anonymized_at IS NULL
      ORDER BY r.id`,
    [applicationId],
  );
  const { rows: cases } = await pool.query<
    CaseRow & { first_fp: string | null; second_fp: string | null; pair_key: string }
  >(
    `SELECT c.*, ${fingerprintSql("r1")} AS first_fp, ${fingerprintSql("r2")} AS second_fp
       FROM application_duplicate_cases c
       LEFT JOIN application_responses r1 ON r1.id = c.first_response_id
       LEFT JOIN application_responses r2 ON r2.id = c.second_response_id
      WHERE c.application_id = $1
      ORDER BY c.created_at DESC, c.id DESC`,
    [applicationId],
  );
  const blocked = new Set(
    cases.filter((row) => OPEN_STATUSES.includes(row.status)).map((row) => row.pair_key),
  );
  const candidates = findDuplicateCandidates(
    responses.map((row) => ({
      responseId: row.id,
      name: row.name,
      surname: row.surname,
      email: row.email,
      dnis: [extractDni(row.responses ?? {}), row.dni],
    })),
  ).filter((pair) => !blocked.has(pairKey(pair.firstResponseId, pair.secondResponseId)));

  const shown = new Set<number>();
  for (const pair of candidates) {
    shown.add(pair.firstResponseId);
    shown.add(pair.secondResponseId);
  }
  for (const row of cases) {
    for (const id of [row.first_response_id, row.second_response_id, row.kept_response_id]) {
      if (id != null) shown.add(id);
    }
  }
  return {
    responses: responses
      .filter((row) => shown.has(row.id))
      .map(({ surname, ...row }) => ({
        ...row,
        name: [row.name, surname].filter(Boolean).join(" ") || null,
        first_name: row.name,
        last_name: surname,
      })),
    candidates: candidates.map((pair) => ({
      first_response_id: pair.firstResponseId,
      second_response_id: pair.secondResponseId,
      reasons: pair.reasons,
      name_similarity: pair.nameSimilarity,
      email_similarity: pair.emailSimilarity,
    })),
    cases: cases.map((row) => ({
      id: row.id,
      status: row.status,
      first_response_id: row.first_response_id,
      second_response_id: row.second_response_id,
      kept_response_id: row.kept_response_id,
      submitted_from_response_id: row.submitted_from_response_id,
      outdated:
        row.status === "pending" &&
        (row.first_fp !== row.source_fingerprints?.[String(row.first_response_id)] ||
          row.second_fp !== row.source_fingerprints?.[String(row.second_response_id)]),
      expires_at: row.expires_at,
      created_at: row.created_at,
      resolved_at: row.resolved_at,
    })),
  };
}

// ── shared locking ──────────────────────────────────────────────────────────

interface LockedResponse {
  id: number;
  user_id: number;
  status: string;
  submitted_at: Date | null;
  responses: Record<string, unknown>;
  fingerprint: string;
}

/**
 * Locks the two owners (account removal locks users before their responses,
 * so this order cannot deadlock with it) and then both responses of the form.
 * The pair must belong to the form and to two different active accounts.
 */
async function lockPair(
  client: pg.PoolClient,
  applicationId: number,
  responseIds: [number, number],
): Promise<[LockedResponse, LockedResponse]> {
  const [firstId, secondId] = [...responseIds].sort((a, b) => a - b) as [number, number];
  if (firstId === secondId) throw new ConflictError("Pick two different responses");
  const { rows: owners } = await client.query<{ id: number; user_id: number }>(
    `SELECT id, user_id FROM application_responses
      WHERE id = ANY($1::int[]) AND application_id = $2`,
    [[firstId, secondId], applicationId],
  );
  if (owners.length !== 2) throw new NotFoundError("Response not found");
  const userIds = [...new Set(owners.map((row) => row.user_id))].sort((a, b) => a - b);
  const { rows: users } = await client.query(
    `SELECT id FROM users
      WHERE id = ANY($1::int[]) AND account_state = 'active' AND anonymized_at IS NULL
      ORDER BY id FOR UPDATE`,
    [userIds],
  );
  if (users.length !== 2) throw new NotFoundError("Response not found");
  const { rows } = await client.query<LockedResponse>(
    `SELECT r.id, r.user_id, r.status, r.submitted_at, r.responses, ${fingerprintSql("r")} AS fingerprint
       FROM application_responses r
      WHERE r.id = ANY($1::int[]) AND r.application_id = $2
      ORDER BY r.id FOR UPDATE`,
    [[firstId, secondId], applicationId],
  );
  if (rows.length !== 2) throw new NotFoundError("Response not found");
  return rows as [LockedResponse, LockedResponse];
}

// ── reviewer actions ──────────────────────────────────────────────────────────

/** A reviewer marks a pair as two different people; it stops being suggested. */
export async function dismissDuplicate(
  actorId: number,
  applicationId: number,
  responseIds: [number, number],
): Promise<{ id: number }> {
  return withTransaction(async (client) => {
    await requireApplication(client, applicationId);
    const [first, second] = await lockPair(client, applicationId, responseIds);
    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO application_duplicate_cases
         (application_id, first_response_id, second_response_id, pair_key, status,
          created_by, resolved_by, resolved_at)
       VALUES ($1, $2, $3, $4, 'dismissed', $5, $5, now())
       ON CONFLICT (application_id, pair_key)
         WHERE status IN ('dismissed', 'pending', 'kept_separate')
         DO NOTHING
       RETURNING id`,
      [applicationId, first.id, second.id, pairKey(first.id, second.id), actorId],
    );
    if (!rows[0]) {
      throw new ConflictError("This pair already has an open decision", {
        code: ERROR_REASONS.DUPLICATE_CASE_EXISTS,
      });
    }
    await audit(client, {
      actorId,
      entityType: "application_duplicate_case",
      entityId: rows[0].id,
      action: "dismissed",
      after: { response_ids: [first.id, second.id] },
    });
    return { id: rows[0].id };
  });
}

const hasValue = (value: unknown) =>
  value !== undefined &&
  value !== null &&
  value !== "" &&
  !(Array.isArray(value) && value.length === 0);

const SHARE_SUFFIX = sponsorShareKey("");

/**
 * The merged answers: each question takes the response the reviewer picked,
 * or the one that answered it. A file's sponsor-sharing consent travels with
 * the file it belongs to.
 */
export function mergeAnswers(
  first: { id: number; responses: Record<string, unknown> },
  second: { id: number; responses: Record<string, unknown> },
  fieldSources: Record<string, number>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(first.responses), ...Object.keys(second.responses)]);
  for (const key of keys) {
    const base = key.endsWith(SHARE_SUFFIX) ? key.slice(0, -SHARE_SUFFIX.length) : key;
    const chosen = fieldSources[base];
    const source =
      chosen === second.id
        ? second
        : chosen === first.id
          ? first
          : hasValue(first.responses[base])
            ? first
            : second;
    if (key in source.responses) merged[key] = source.responses[key];
  }
  return merged;
}

export interface ProposeMergeInput {
  response_ids: [number, number];
  field_sources: Record<string, number>;
  submitted_from_response_id: number;
}

/**
 * Stores the merge proposal and emails each owner a private link. Nothing is
 * changed on the responses until the applicant answers.
 */
export async function proposeDuplicateMerge(
  actorId: number,
  applicationId: number,
  input: ProposeMergeInput,
): Promise<{ id: number; expires_at: Date }> {
  return withTransaction(async (client) => {
    const app = await requireApplication(client, applicationId);
    const [first, second] = await lockPair(client, applicationId, input.response_ids);
    for (const response of [first, second]) {
      if (!MERGEABLE_STATUSES.has(response.status)) {
        throw new ConflictError("Only responses without a decision can be merged", {
          code: ERROR_REASONS.DUPLICATE_MERGE_DECIDED,
        });
      }
    }
    const pairIds = [first.id, second.id];
    if (!pairIds.includes(input.submitted_from_response_id)) {
      throw new ConflictError("The submission date must come from one of the two responses");
    }
    const submittedFrom = input.submitted_from_response_id === first.id ? first : second;
    if (!submittedFrom.submitted_at && (first.submitted_at || second.submitted_at)) {
      throw new ConflictError("Keep the submission date of a submitted response", {
        code: ERROR_REASONS.DUPLICATE_MERGE_SUBMISSION_REQUIRED,
      });
    }
    for (const source of Object.values(input.field_sources)) {
      if (!pairIds.includes(source)) {
        throw new ConflictError("Every answer must come from one of the two responses");
      }
    }
    const merged = mergeAnswers(first, second, input.field_sources);

    const tokens = {
      first: randomBytes(32).toString("base64url"),
      second: randomBytes(32).toString("base64url"),
    };
    const { rows } = await client.query<{ id: number; expires_at: Date }>(
      `INSERT INTO application_duplicate_cases
         (application_id, first_response_id, second_response_id, pair_key, status,
          merged_responses, submitted_from_response_id, source_fingerprints,
          first_token_hash, second_token_hash, expires_at, created_by)
       VALUES ($1, $2, $3, $4, 'pending', $5::jsonb, $6, $7::jsonb, $8, $9,
               now() + make_interval(days => $10), $11)
       ON CONFLICT (application_id, pair_key)
         WHERE status IN ('dismissed', 'pending', 'kept_separate')
         DO NOTHING
       RETURNING id, expires_at`,
      [
        applicationId,
        first.id,
        second.id,
        pairKey(first.id, second.id),
        JSON.stringify(merged),
        submittedFrom.id,
        JSON.stringify({ [first.id]: first.fingerprint, [second.id]: second.fingerprint }),
        hashToken(tokens.first),
        hashToken(tokens.second),
        PROPOSAL_DAYS,
        actorId,
      ],
    );
    const created = rows[0];
    if (!created) {
      throw new ConflictError("This pair already has an open decision", {
        code: ERROR_REASONS.DUPLICATE_CASE_EXISTS,
      });
    }

    const eventName = await getEventName(client);
    const owners = [
      { response: first, token: tokens.first, other: second },
      { response: second, token: tokens.second, other: first },
    ];
    const comms = new Map<number, Awaited<ReturnType<typeof loadUserComms>>>();
    for (const { response } of owners) {
      comms.set(response.user_id, await loadUserComms(client, response.user_id));
    }
    for (const { response, token, other } of owners) {
      const user = comms.get(response.user_id);
      const otherUser = comms.get(other.user_id);
      if (!user || !otherUser) throw new NotFoundError("User not found");
      const payload: EmailPayload = {
        template: "application.duplicate",
        recipient: user.email,
        language: user.language,
        vars: {
          name: user.name ?? "",
          applicationName: app.name,
          eventName,
          email: user.email,
          otherEmail: maskEmail(otherUser.email),
          mergeUrl: webUrl(`/applications/duplicate#token=${token}`),
        },
      };
      await client.query(
        `INSERT INTO notification_outbox (user_id, category, channel, payload)
         VALUES ($1, 'application', 'email', $2::jsonb)`,
        [response.user_id, JSON.stringify(payload)],
      );
    }

    // Field names only: the answers themselves stay out of the audit log.
    await audit(client, {
      actorId,
      entityType: "application_duplicate_case",
      entityId: created.id,
      action: "merge_proposed",
      after: {
        response_ids: pairIds,
        submitted_from_response_id: submittedFrom.id,
        fields_from_second: Object.keys(merged).filter(
          (key) =>
            key in second.responses &&
            JSON.stringify(merged[key]) === JSON.stringify(second.responses[key]) &&
            JSON.stringify(merged[key]) !== JSON.stringify(first.responses[key]),
        ),
      },
    });
    return created;
  });
}

/**
 * Withdraws a pending proposal (its links stop working) or undoes a
 * dismissal, so the pair is suggested again.
 */
export async function cancelDuplicateCase(
  actorId: number,
  applicationId: number,
  caseId: number,
  canEditResponses: boolean,
): Promise<void> {
  await withTransaction(async (client) => {
    await requireApplication(client, applicationId);
    const { rows } = await client.query<CaseRow>(
      `SELECT * FROM application_duplicate_cases
        WHERE id = $1 AND application_id = $2 FOR UPDATE`,
      [caseId, applicationId],
    );
    const row = rows[0];
    if (!row) throw new NotFoundError("Duplicate case not found");
    if (row.status === "pending" && !canEditResponses) {
      throw new ForbiddenError("Missing required capability");
    }
    if (row.status !== "pending" && row.status !== "dismissed") {
      throw new ConflictError("This case is already closed", {
        code: ERROR_REASONS.DUPLICATE_CASE_CLOSED,
      });
    }
    await client.query(
      `UPDATE application_duplicate_cases
          SET status = 'cancelled', merged_responses = NULL, resolved_by = $2,
              resolved_at = now()
        WHERE id = $1`,
      [caseId, actorId],
    );
    await audit(client, {
      actorId,
      entityType: "application_duplicate_case",
      entityId: caseId,
      action: "cancelled",
      before: { status: row.status },
      after: { status: "cancelled" },
    });
  });
}

// ── applicant link ──────────────────────────────────────────────────────────

interface TokenCase extends CaseRow {
  application_name: string;
  template: TemplateField[];
  sections: FormSection[];
  first_user_id: number | null;
  second_user_id: number | null;
  first_email: string | null;
  second_email: string | null;
}

async function findCaseByToken(db: pg.Pool | pg.PoolClient, token: string, lock = false) {
  const hash = hashToken(token);
  const { rows } = await db.query<TokenCase>(
    `SELECT c.*, a.name AS application_name, a.template, a.sections,
            r1.user_id AS first_user_id, r2.user_id AS second_user_id,
            u1.email AS first_email, u2.email AS second_email
       FROM application_duplicate_cases c
       JOIN applications a ON a.id = c.application_id
       LEFT JOIN application_responses r1 ON r1.id = c.first_response_id
       LEFT JOIN application_responses r2 ON r2.id = c.second_response_id
       LEFT JOIN users u1 ON u1.id = r1.user_id
       LEFT JOIN users u2 ON u2.id = r2.user_id
      WHERE c.first_token_hash = $1 OR c.second_token_hash = $1
      ${lock ? "FOR UPDATE OF c" : ""}`,
    [hash],
  );
  const row = rows[0];
  if (!row) {
    throw new NotFoundError("This link is not valid", {
      code: ERROR_REASONS.DUPLICATE_MERGE_INVALID,
    });
  }
  const side: Side = row.first_token_hash === hash ? "first" : "second";
  return { row, side };
}

/** File answers show their file name: the other account's file is not downloadable here. */
function displayAnswers(
  template: TemplateField[],
  responses: Record<string, unknown>,
): Record<string, unknown> {
  const fileKeys = new Set(template.filter((field) => field.kind === "file").map((f) => f.key));
  return Object.fromEntries(
    Object.entries(responses).map(([key, value]) => [
      key,
      fileKeys.has(key) && typeof value === "string" ? (value.split("/").pop() ?? value) : value,
    ]),
  );
}

function assertOpen(row: TokenCase): void {
  if (row.status !== "pending") {
    throw new ConflictError("This merge has already been answered", {
      code: ERROR_REASONS.DUPLICATE_MERGE_CLOSED,
      status: row.status,
    });
  }
  if (row.expires_at && row.expires_at.getTime() <= Date.now()) {
    throw new ConflictError("This link has expired", {
      code: ERROR_REASONS.DUPLICATE_MERGE_EXPIRED,
    });
  }
  if (row.first_user_id == null || row.second_user_id == null) {
    throw new ConflictError("One of the applications no longer exists", {
      code: ERROR_REASONS.DUPLICATE_MERGE_OUTDATED,
    });
  }
}

export interface DuplicateMergeView {
  status: string;
  application_name: string;
  you: Side;
  accounts: Array<{ side: Side; email: string }>;
  template: TemplateField[];
  sections: FormSection[];
  answers: Record<string, unknown>;
  submitted_at: Date | null;
  expires_at: Date | null;
}

/** What the emailed link shows: the merged application and both accounts. */
export async function lookupDuplicateMerge(token: string): Promise<DuplicateMergeView> {
  const { row, side } = await findCaseByToken(pool, token);
  assertOpen(row);
  const { rows: source } = await pool.query<{ submitted_at: Date | null }>(
    `SELECT submitted_at FROM application_responses WHERE id = $1`,
    [row.submitted_from_response_id],
  );
  const email = (which: Side) => {
    const value = (which === "first" ? row.first_email : row.second_email) ?? "";
    // The holder sees their own address; the other one only enough to recognize it.
    return which === side ? value : maskEmail(value);
  };
  return {
    status: row.status,
    application_name: row.application_name,
    you: side,
    accounts: [
      { side: "first", email: email("first") },
      { side: "second", email: email("second") },
    ],
    template: row.template,
    sections: row.sections,
    answers: displayAnswers(row.template, row.merged_responses ?? {}),
    submitted_at: source[0]?.submitted_at ?? null,
    expires_at: row.expires_at,
  };
}

/**
 * Files chosen from the account that will be deleted are copied under the
 * kept account first: removal deletes every upload of the deleted account.
 * Copies are keyed by case, so a retried decision rewrites the same objects.
 */
async function copyDiscardedFiles(
  row: TokenCase,
  keptUserId: number,
  discardedUserId: number,
): Promise<Record<string, unknown>> {
  const merged = { ...(row.merged_responses ?? {}) };
  const ownedPrefix = `uploads/${row.application_id}/${discardedUserId}/`;
  for (const [key, value] of Object.entries(merged)) {
    if (typeof value !== "string" || !value.startsWith(ownedPrefix)) continue;
    const fileName = value.split("/").pop() ?? "file";
    const copyKey = `uploads/${row.application_id}/${keptUserId}/${key}/merge-${row.id}/${fileName}`;
    const object = await getObject(value);
    if (!object.Body) throw new NotFoundError("File not found");
    await putObject(
      copyKey,
      await object.Body.transformToByteArray(),
      object.ContentType ?? "application/octet-stream",
    );
    merged[key] = copyKey;
  }
  return merged;
}

export type DuplicateDecision = { decision: "keep_separate" } | { decision: "merge"; keep: Side };

/**
 * The applicant's answer. Exactly one answer wins (the case row is locked);
 * a merge rewrites the kept response, deletes the other one and then removes
 * the other account through the H54 removal flow.
 */
export async function decideDuplicateMerge(
  token: string,
  input: DuplicateDecision,
): Promise<{ status: "merged" | "kept_separate" }> {
  const { row: preview } = await findCaseByToken(pool, token);
  assertOpen(preview);
  const firstUser = preview.first_user_id as number;
  const secondUser = preview.second_user_id as number;
  const keep = input.decision === "merge" ? input.keep : null;
  const keptUserId = keep === "second" ? secondUser : firstUser;
  const discardedUserId = keep === "second" ? firstUser : secondUser;
  const merged =
    keep === null ? null : await copyDiscardedFiles(preview, keptUserId, discardedUserId);

  const outcome = await withTransaction(async (client) => {
    // Owners first (the removal lock order), then the case: a concurrent
    // answer that already won leaves this one a closed case, not a missing
    // response.
    await client.query(`SELECT id FROM users WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE`, [
      [firstUser, secondUser],
    ]);
    const { row, side } = await findCaseByToken(client, token, true);
    assertOpen(row);
    const [first, second] = await lockPair(client, row.application_id, [
      row.first_response_id as number,
      row.second_response_id as number,
    ]);
    // The link's owner answered; the audit row names that account (H53).
    const actorId = side === "first" ? first.user_id : second.user_id;
    if (
      first.fingerprint !== row.source_fingerprints?.[String(first.id)] ||
      second.fingerprint !== row.source_fingerprints?.[String(second.id)]
    ) {
      throw new ConflictError("One of the applications changed after this was proposed", {
        code: ERROR_REASONS.DUPLICATE_MERGE_OUTDATED,
      });
    }

    if (keep === null || merged === null) {
      await client.query(
        `UPDATE application_duplicate_cases
            SET status = 'kept_separate', merged_responses = NULL, resolved_at = now()
          WHERE id = $1`,
        [row.id],
      );
      await audit(client, {
        actorId,
        entityType: "application_duplicate_case",
        entityId: row.id,
        action: "kept_separate",
        source: "email",
        after: { status: "kept_separate" },
      });
      return { status: "kept_separate" as const };
    }

    const kept = keep === "first" ? first : second;
    const discarded = keep === "first" ? second : first;
    const eligibility = await getAccountRemovalEligibility(client, discarded.user_id);
    if (eligibility.action !== "delete") {
      throw new ConflictError("The other account has event history; contact the organizers", {
        code: ERROR_REASONS.DUPLICATE_MERGE_NEEDS_STAFF,
      });
    }
    const source = row.submitted_from_response_id === first.id ? first : second;
    await client.query(
      `UPDATE application_responses
          SET responses = $2::jsonb, status = $3::app_response_status, submitted_at = $4
        WHERE id = $1`,
      [kept.id, JSON.stringify(merged), source.status, source.submitted_at],
    );
    const dni = extractDni(merged);
    if (dni) await client.query(`UPDATE users SET dni = $2 WHERE id = $1`, [kept.user_id, dni]);
    await client.query(
      `UPDATE application_responses SET referrer_application_id = NULL
        WHERE referrer_application_id = $1`,
      [discarded.id],
    );
    await client.query(`DELETE FROM applicant_reviews WHERE response_id = $1`, [discarded.id]);
    await client.query(`DELETE FROM application_responses WHERE id = $1`, [discarded.id]);
    await client.query(
      `UPDATE application_duplicate_cases
          SET status = 'merged', merged_responses = NULL, kept_response_id = $2,
              resolved_at = now()
        WHERE id = $1`,
      [row.id, kept.id],
    );
    await audit(client, {
      actorId,
      entityType: "application_response",
      entityId: kept.id,
      action: "duplicate_merged",
      source: "email",
      before: { status: kept.status },
      after: { status: source.status, case_id: row.id, merged_response_id: discarded.id },
    });
    await audit(client, {
      actorId,
      entityType: "application_duplicate_case",
      entityId: row.id,
      action: "merged",
      source: "email",
      after: { kept_response_id: kept.id },
    });
    return { status: "merged" as const };
  });

  if (outcome.status === "merged") {
    // The merged response is committed; the other account goes through the
    // normal removal, which retries its own external cleanup on failure.
    try {
      await runAccountRemoval({
        targetId: discardedUserId,
        actorId: null,
        source: "duplicate_merge",
        requestedAction: "delete",
      });
    } catch (error) {
      console.error(`[duplicates] removal of merged account ${discardedUserId} failed`, error);
    }
  }
  return outcome;
}
