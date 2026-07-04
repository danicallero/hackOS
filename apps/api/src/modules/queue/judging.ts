import { type Question, validateAnswers } from "@hackos/shared/questions";
import { pool, type Queryable, withTransaction } from "../../db/pool.js";
import { BadRequestError, NotFoundError } from "../../lib/errors.js";

/**
 * Judging (H36-H37, H40). attempt_review is 1:1 with queue_entries — the
 * unique (challenge_id, repo_id) index on queue_entries already makes a
 * second evaluation of the same repo/challenge structurally impossible, so
 * H37's "never create a second evaluation" falls out for free: searching
 * just needs to find the existing row.
 */

/**
 * Load a challenge's judging panel. Returns typed questions when the panel was
 * built with the question catalogue (H44); otherwise falls back to the legacy
 * key set (["innovation", ...] or [{ key }, ...]) so pre-builder challenges
 * still validate leniently.
 */
async function loadCriteria(
  client: Queryable,
  challengeId: number,
): Promise<{ typed: Question[] | null; keys: Set<string> | null }> {
  const { rows } = await client.query(
    `SELECT judging_panel_criteria FROM challenges WHERE id = $1`,
    [challengeId],
  );
  const criteria = rows[0]?.judging_panel_criteria;
  if (!Array.isArray(criteria)) return { typed: null, keys: null }; // no panel yet — lenient
  const isTyped =
    criteria.length > 0 &&
    criteria.every(
      (c: unknown) =>
        c != null && typeof c === "object" && typeof (c as { kind?: unknown }).kind === "string",
    );
  if (isTyped) {
    const typed = criteria as Question[];
    return { typed, keys: new Set(typed.map((q) => q.key)) };
  }
  const keys = criteria
    .map((c: unknown) =>
      typeof c === "string"
        ? c
        : c && typeof c === "object"
          ? (c as { key?: unknown }).key
          : undefined,
    )
    .filter((k: unknown): k is string => typeof k === "string");
  return { typed: null, keys: new Set(keys) };
}

export interface AttemptReviewPatch {
  scores?: Record<string, unknown>;
  notes?: string;
  submit?: boolean;
}

export async function getAttemptReview(entryId: number) {
  const entryRes = await pool.query(`SELECT id FROM queue_entries WHERE id = $1`, [entryId]);
  if (entryRes.rowCount === 0) throw new NotFoundError("Queue entry not found", { entryId });
  const { rows } = await pool.query(`SELECT * FROM attempt_review WHERE attempt_id = $1`, [
    entryId,
  ]);
  return rows[0] ?? { attempt_id: entryId, scores: {}, notes: null, status: "draft" };
}

export async function upsertAttemptReview(
  entryId: number,
  actorId: number,
  patch: AttemptReviewPatch,
) {
  return withTransaction(async (client) => {
    const entryRes = await client.query(`SELECT challenge_id FROM queue_entries WHERE id = $1`, [
      entryId,
    ]);
    if (entryRes.rowCount === 0) throw new NotFoundError("Queue entry not found", { entryId });
    const challengeId = entryRes.rows[0].challenge_id;

    const { typed, keys } =
      patch.scores || patch.submit
        ? await loadCriteria(client, challengeId)
        : { typed: null, keys: null };
    if (patch.scores) {
      if (typed) {
        // Type/range-check the provided answers (unknown keys, wrong types).
        const errors = validateAnswers(typed, patch.scores, { requireAll: false });
        if (errors.length)
          throw new BadRequestError(
            `Invalid answers: ${errors.map((e) => `${e.key}: ${e.message}`).join("; ")}`,
            { errors },
          );
      } else if (keys) {
        for (const k of Object.keys(patch.scores)) {
          if (!keys.has(k))
            throw new BadRequestError(`Unknown judging criterion "${k}"`, { criterion: k });
        }
      }
    }

    await client.query(
      `INSERT INTO attempt_review (attempt_id) VALUES ($1) ON CONFLICT (attempt_id) DO NOTHING`,
      [entryId],
    );
    const { rows: currentRows } = await client.query(
      `SELECT * FROM attempt_review WHERE attempt_id = $1 FOR UPDATE`,
      [entryId],
    );
    const current = currentRows[0];
    const currentScores: Record<string, unknown> = current.scores ?? {};

    const changedFields: string[] = [];
    const previous: Record<string, unknown> = {};
    const next: Record<string, unknown> = {};

    let newScores = currentScores;
    if (patch.scores) {
      for (const [k, v] of Object.entries(patch.scores)) {
        // JSON-compare so identical multi_choice arrays don't spawn versions.
        if (JSON.stringify(currentScores[k]) !== JSON.stringify(v)) {
          changedFields.push(`scores.${k}`);
          previous[`scores.${k}`] = currentScores[k] ?? null;
          next[`scores.${k}`] = v;
        }
      }
      newScores = { ...currentScores, ...patch.scores };
    }

    let newNotes = current.notes;
    if (patch.notes !== undefined && patch.notes !== current.notes) {
      changedFields.push("notes");
      previous.notes = current.notes;
      next.notes = patch.notes;
      newNotes = patch.notes;
    }

    let newStatus = current.status;
    if (patch.submit && current.status !== "submitted") {
      changedFields.push("status");
      previous.status = current.status;
      next.status = "submitted";
      newStatus = "submitted";
    }

    // On submit, every required question must be answered (H44). Validate the
    // MERGED answers, not just this patch, so a submit that carries no new
    // scores still checks what was saved across earlier partial saves.
    if (patch.submit && typed) {
      const errors = validateAnswers(typed, newScores, { requireAll: true });
      if (errors.length)
        throw new BadRequestError(
          `Cannot submit: ${errors.map((e) => `${e.key}: ${e.message}`).join("; ")}`,
          { errors },
        );
    }

    if (changedFields.length === 0) return current; // no-op save, no version row

    const { rows: updatedRows } = await client.query(
      `UPDATE attempt_review SET scores = $1, notes = $2, status = $3 WHERE attempt_id = $4 RETURNING *`,
      [JSON.stringify(newScores), newNotes, newStatus, entryId],
    );

    await client.query(
      `INSERT INTO attempt_review_versions (attempt_id, author_id, changed_fields, previous, new)
       VALUES ($1, $2, $3, $4, $5)`,
      [entryId, actorId, changedFields, JSON.stringify(previous), JSON.stringify(next)],
    );

    return updatedRows[0];
  });
}

export async function listAttemptReviewVersions(entryId: number) {
  const { rows } = await pool.query(
    `SELECT v.*, u.name, u.surname
       FROM attempt_review_versions v
       JOIN users u ON u.id = v.author_id
      WHERE v.attempt_id = $1
      ORDER BY v.created_at ASC`,
    [entryId],
  );
  return rows;
}

// ── judging_session presence (H36) ──────────────────────────────────────────

export async function joinJudgingSession(entryId: number, judgeId: number, roomId?: number) {
  const { rows } = await pool.query(
    `INSERT INTO judging_session (judge_id, queue_entry_id, room_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (judge_id, queue_entry_id) WHERE ended_at IS NULL DO NOTHING
     RETURNING *`,
    [judgeId, entryId, roomId ?? null],
  );
  if (rows.length > 0) return rows[0];
  const existing = await pool.query(
    `SELECT * FROM judging_session WHERE judge_id = $1 AND queue_entry_id = $2 AND ended_at IS NULL`,
    [judgeId, entryId],
  );
  return existing.rows[0];
}

export async function leaveJudgingSession(entryId: number, judgeId: number) {
  const { rows } = await pool.query(
    `UPDATE judging_session SET ended_at = now()
      WHERE judge_id = $1 AND queue_entry_id = $2 AND ended_at IS NULL
      RETURNING *`,
    [judgeId, entryId],
  );
  return rows[0] ?? null;
}

export async function listActiveJudgingSessions(entryId: number) {
  const { rows } = await pool.query(
    `SELECT js.*, u.name, u.surname
       FROM judging_session js
       JOIN users u ON u.id = js.judge_id
      WHERE js.queue_entry_id = $1 AND js.ended_at IS NULL
      ORDER BY js.started_at ASC`,
    [entryId],
  );
  return rows;
}

// ── H37: manual search ───────────────────────────────────────────────────────

export async function searchChallengeQueue(challengeId: number, q: string) {
  const like = `%${q}%`;
  const { rows } = await pool.query(
    `SELECT qe.*, r.name AS repo_name,
            (ar.attempt_id IS NOT NULL) AS has_review, ar.status AS review_status
       FROM queue_entries qe
       JOIN repos r ON r.id = qe.repo_id
       LEFT JOIN attempt_review ar ON ar.attempt_id = qe.id
      WHERE qe.challenge_id = $1
        AND (r.name ILIKE $2 OR CAST(r.id AS text) = $3 OR CAST(qe.id AS text) = $3)
      ORDER BY qe.position ASC NULLS LAST, qe.id ASC
      LIMIT 25`,
    [challengeId, like, q],
  );
  return rows;
}
