import { EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import { type Question, validateAnswers } from "@hackos/shared/questions";
import { pool, type Queryable, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { BadRequestError, NotFoundError } from "../../lib/errors.js";
import { broadcast } from "../../lib/sse.js";
import { resolveChallengePanel } from "./criteria-merge.js";
import { lockQueueGroupForEntry } from "./evaluation-lock.js";
import { writeQueueHistory } from "./history.js";
import { REPO_MEMBER_RELATION_SQL } from "./membership.js";
import { notifyChallengeQueueChanged } from "./notify.js";
import type { QueueEntryRow } from "./types.js";

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
  // H46: a merged queue group has ONE judging form for all its challenges, so
  // the entry is validated against the group's panel when there is one. Every
  // 1:1 group falls back to the challenge's own — unchanged behaviour.
  const criteria = await resolveChallengePanel(client, challengeId);
  if (criteria.length === 0) return { typed: null, keys: null }; // no panel yet — lenient
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
  /**
   * Out-of-band corrections (the reviews overview, H46) are a sensitive
   * mutation and get an audit_log row in the same transaction (H53). The
   * judging panel itself doesn't: it autosaves every 800ms while a judge
   * types, and attempt_review_versions is already its operational trail.
   */
  opts: { audit?: boolean } = {},
) {
  const { review, completedEntry, changed } = await withTransaction(async (client) => {
    // A submitted review is the first-evaluation boundary for queue-group
    // structure and criteria. Take the group lock before the entry lock, the
    // same order used by merge/split/update, so neither side can pass its
    // evaluation check while the other commits (H46, plan/07 §2).
    if (patch.submit) await lockQueueGroupForEntry(client, entryId);

    // Lock the entry row: a submit may complete the presentation (below), so
    // its status must be stable for the duration of the transaction.
    const entryRes = await client.query(
      `SELECT id, challenge_id, status FROM queue_entries WHERE id = $1 FOR UPDATE`,
      [entryId],
    );
    if (entryRes.rowCount === 0) throw new NotFoundError("Queue entry not found", { entryId });
    const entryStatus: string = entryRes.rows[0].status;
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
    const justSubmitted = Boolean(patch.submit) && current.status !== "submitted";
    if (justSubmitted) {
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

    if (changedFields.length === 0)
      return { review: current, completedEntry: null, changed: false }; // no-op save

    const { rows: updatedRows } = await client.query(
      `UPDATE attempt_review SET scores = $1, notes = $2, status = $3 WHERE attempt_id = $4 RETURNING *`,
      [JSON.stringify(newScores), newNotes, newStatus, entryId],
    );

    await client.query(
      `INSERT INTO attempt_review_versions (attempt_id, author_id, changed_fields, previous, new)
       VALUES ($1, $2, $3, $4, $5)`,
      [entryId, actorId, changedFields, JSON.stringify(previous), JSON.stringify(next)],
    );

    if (opts.audit) {
      await audit(client, {
        actorId,
        entityType: "attempt_review",
        entityId: entryId,
        action: patch.submit ? "review.submit" : "review.update",
        before: previous,
        after: next,
      });
    }

    // H37: submitting the final review closes the presentation. Only a team
    // actually in the room / presenting is completed — submitting a review for
    // a team still in the queue (e.g. a late correction) leaves its status be.
    let completedEntry: QueueEntryRow | null = null;
    if (justSubmitted && (entryStatus === "presenting" || entryStatus === "in_room")) {
      const done = await client.query(
        `UPDATE queue_entries SET status = 'completed', completed_at = now()
          WHERE id = $1 AND status IN ('presenting', 'in_room')
          RETURNING *`,
        [entryId],
      );
      if (done.rowCount) {
        completedEntry = done.rows[0];
        await writeQueueHistory(client, {
          entryId,
          actorId,
          previousStatus: entryStatus,
          newStatus: "completed",
          action: "complete",
          metadata: { viaReviewSubmit: true },
        });
      }
    }

    return { review: updatedRows[0], completedEntry, changed: true };
  });

  if (changed) {
    await broadcast(`${SSE_TOPICS.QUEUE_REVIEW_PREFIX}${entryId}`, EVENTS.QUEUE_REVIEW_CHANGED, {
      entryId,
    });
  }
  // One queue transition -> one broadcast (plan/07 invariant 5). The judging
  // panel's live query drops the completed team from the room on this event.
  if (completedEntry) {
    await broadcast(SSE_TOPICS.QUEUE, EVENTS.QUEUE_ENTRY_CHANGED, completedEntry);
    await notifyChallengeQueueChanged(pool, completedEntry.challenge_id);
  }

  return review;
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
  if (rows.length > 0) {
    await broadcast(`${SSE_TOPICS.QUEUE_REVIEW_PREFIX}${entryId}`, EVENTS.QUEUE_REVIEW_CHANGED, {
      entryId,
    });
    return rows[0];
  }
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
  if (rows[0]) {
    await broadcast(`${SSE_TOPICS.QUEUE_REVIEW_PREFIX}${entryId}`, EVENTS.QUEUE_REVIEW_CHANGED, {
      entryId,
    });
  }
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
            (ar.attempt_id IS NOT NULL) AS has_review, ar.status AS review_status,
            busy.room_id AS blocked_by_room_id,
            busy.room_name AS blocked_by_room_name,
            busy.team_name AS blocked_by_team_name,
            busy.status AS blocked_by_status
       FROM queue_entries qe
       JOIN repos r ON r.id = qe.repo_id
       LEFT JOIN attempt_review ar ON ar.attempt_id = qe.id
       LEFT JOIN LATERAL (
         SELECT br.id AS room_id, br.name AS room_name, brepo.name AS team_name, bqe.status
           FROM (${REPO_MEMBER_RELATION_SQL}) s1
           JOIN (${REPO_MEMBER_RELATION_SQL}) s2 ON s2.user_id = s1.user_id
           JOIN queue_entries bqe ON bqe.repo_id = s2.repo_id
                                  AND bqe.status IN ('called', 'in_room', 'presenting')
                                  AND bqe.id <> qe.id
           JOIN rooms br ON br.id = bqe.assigned_room_id
           JOIN repos brepo ON brepo.id = bqe.repo_id
          WHERE s1.repo_id = qe.repo_id
          ORDER BY bqe.id
          LIMIT 1
       ) busy ON true
      WHERE qe.challenge_id = $1
        AND (r.name ILIKE $2 OR CAST(r.id AS text) = $3 OR CAST(qe.id AS text) = $3)
      ORDER BY qe.position ASC NULLS LAST, qe.id ASC
      LIMIT 25`,
    [challengeId, like, q],
  );
  return rows;
}
