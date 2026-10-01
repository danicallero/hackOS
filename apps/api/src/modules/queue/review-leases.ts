import type { Question } from "@hackos/shared/questions";
import { pool, type Queryable, withTransaction } from "../../db/pool.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../lib/errors.js";
import { resolveChallengePanel } from "./criteria-merge.js";

const LEASE_SECONDS = 30;

export interface ReviewFieldLease {
  field: string;
  judgeId: number;
  name: string | null;
  surname: string | null;
  expiresAt: string;
}

function isTextQuestion(question: Question): boolean {
  return question.kind === "short_text" || question.kind === "long_text";
}

export function textReviewFields(criteria: Question[] | null): Set<string> {
  return new Set([
    "notes",
    ...(criteria?.filter(isTextQuestion).map((question) => `scores.${question.key}`) ?? []),
  ]);
}

async function assertLeaseField(client: Queryable, entryId: number, field: string): Promise<void> {
  const entry = await client.query(`SELECT challenge_id FROM queue_entries WHERE id = $1`, [
    entryId,
  ]);
  if (!entry.rowCount) throw new NotFoundError("Queue entry not found", { entryId });
  const panel = await resolveChallengePanel(client, Number(entry.rows[0].challenge_id));
  const criteria = panel.every(
    (question: unknown) =>
      question != null &&
      typeof question === "object" &&
      typeof (question as Question).kind === "string",
  )
    ? (panel as Question[])
    : null;
  if (!textReviewFields(criteria).has(field)) {
    throw new BadRequestError("A lease can only be acquired for a text answer or notes", { field });
  }
}

function leaseRow(row: Record<string, unknown>): ReviewFieldLease {
  return {
    field: String(row.field_key),
    judgeId: Number(row.judge_id),
    name: (row.name as string | null) ?? null,
    surname: (row.surname as string | null) ?? null,
    expiresAt: String(row.expires_at),
  };
}

export async function acquireReviewFieldLease(
  entryId: number,
  judgeId: number,
  field: string,
): Promise<ReviewFieldLease> {
  return withTransaction(async (client) => {
    await assertLeaseField(client, entryId, field);
    const acquired = await client.query(
      `INSERT INTO judging_field_leases (queue_entry_id, field_key, judge_id, expires_at)
       VALUES ($1, $2, $3, now() + interval '${LEASE_SECONDS} seconds')
       ON CONFLICT (queue_entry_id, field_key) DO UPDATE
         SET judge_id = EXCLUDED.judge_id,
             expires_at = EXCLUDED.expires_at
       WHERE judging_field_leases.expires_at <= now()
          OR judging_field_leases.judge_id = EXCLUDED.judge_id
       RETURNING field_key, judge_id, expires_at`,
      [entryId, field, judgeId],
    );
    if (acquired.rowCount) {
      const row = acquired.rows[0];
      const owner = await client.query(`SELECT u.name, u.surname FROM users u WHERE u.id = $1`, [
        row.judge_id,
      ]);
      return leaseRow({ ...row, ...owner.rows[0] });
    }

    const owner = await client.query(
      `SELECT l.field_key, l.judge_id, l.expires_at, u.name, u.surname
         FROM judging_field_leases l
         JOIN users u ON u.id = l.judge_id
        WHERE l.queue_entry_id = $1 AND l.field_key = $2 AND l.expires_at > now()`,
      [entryId, field],
    );
    if (!owner.rowCount)
      throw new ConflictError("The editing lease could not be acquired", { field });
    throw new ConflictError("Another judge is editing this field", {
      code: "review_field_locked",
      lease: leaseRow(owner.rows[0]),
    });
  });
}

export async function releaseReviewFieldLease(entryId: number, judgeId: number, field: string) {
  const { rows } = await pool.query(
    `DELETE FROM judging_field_leases
      WHERE queue_entry_id = $1 AND field_key = $2 AND judge_id = $3
      RETURNING field_key`,
    [entryId, field, judgeId],
  );
  return rows[0] ?? null;
}

export async function releaseReviewFieldLeases(
  client: Queryable,
  entryId: number,
  judgeId: number,
  fields?: string[],
) {
  const result = await client.query(
    `DELETE FROM judging_field_leases
      WHERE queue_entry_id = $1 AND judge_id = $2
        AND ($3::text[] IS NULL OR field_key = ANY($3))
      RETURNING field_key`,
    [entryId, judgeId, fields?.length ? fields : null],
  );
  return result.rows.map((row) => String(row.field_key));
}

export async function listReviewFieldLeases(entryId: number): Promise<ReviewFieldLease[]> {
  const { rows } = await pool.query(
    `SELECT l.field_key, l.judge_id, l.expires_at, u.name, u.surname
       FROM judging_field_leases l
       JOIN users u ON u.id = l.judge_id
      WHERE l.queue_entry_id = $1 AND l.expires_at > now()
      ORDER BY l.field_key`,
    [entryId],
  );
  return rows.map(leaseRow);
}

/** Enforced inside the review-save transaction; UI state alone is not a lock. */
export async function assertTextFieldLeases(
  client: Queryable,
  entryId: number,
  judgeId: number,
  fields: string[],
): Promise<void> {
  if (!fields.length) return;
  const { rows } = await client.query(
    `SELECT field_key
       FROM judging_field_leases
      WHERE queue_entry_id = $1 AND judge_id = $2
        AND field_key = ANY($3::text[]) AND expires_at > now()
      FOR UPDATE`,
    [entryId, judgeId, fields],
  );
  const held = new Set(rows.map((row) => String(row.field_key)));
  const missing = fields.filter((field) => !held.has(field));
  if (missing.length) {
    throw new ConflictError("Your editing lease has expired or belongs to another judge", {
      code: "review_field_lease_required",
      fields: missing,
    });
  }
}
