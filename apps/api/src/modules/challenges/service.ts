import type { Question } from "@hackos/shared/questions";
import { pool, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { ConflictError, NotFoundError } from "../../lib/errors.js";
import type { UpdateChallengeBody } from "./schemas.js";

const EDITABLE_COLUMNS = `id, title, description, criteria, prizes,
  judging_panel_criteria, max_presentation_seconds, status, visibility,
  available_from, created_at, updated_at`;

/**
 * The judging window is owned by the queue workstream (queue_settings). Its
 * start doubles as the panel-edit deadline: once judging has started, the
 * questions are frozen (H44 + the operator's timing config).
 */
export async function judgingStartsAt(): Promise<Date | null> {
  const { rows } = await pool.query(`SELECT schedule_start_at FROM queue_settings WHERE id = 1`);
  const raw = rows[0]?.schedule_start_at;
  return raw ? new Date(raw) : null;
}

export async function panelIsLocked(): Promise<boolean> {
  const startsAt = await judgingStartsAt();
  return startsAt !== null && Date.now() >= startsAt.getTime();
}

export async function getChallenge(challengeId: number) {
  const { rows } = await pool.query(`SELECT ${EDITABLE_COLUMNS} FROM challenges WHERE id = $1`, [
    challengeId,
  ]);
  if (!rows[0]) throw new NotFoundError("Challenge not found", { challengeId });
  return rows[0];
}

/** Challenges owned by the enterprise `userId` is a sponsor of (H44/H46). */
export async function listOwnedChallenges(userId: number) {
  const { rows } = await pool.query(
    `SELECT ${EDITABLE_COLUMNS}
       FROM challenges c
       JOIN sponsors author ON author.id = c.author
       JOIN sponsors mine ON mine.enterprise_id = author.enterprise_id
      WHERE mine.user_id = $1
      ORDER BY c.id`,
    [userId],
  );
  return rows;
}

export async function listAllChallenges() {
  const { rows } = await pool.query(`SELECT ${EDITABLE_COLUMNS} FROM challenges ORDER BY id`);
  return rows;
}

/**
 * Apply a partial edit (H44). Editing the judging panel after judging has
 * started is rejected. Every successful edit writes one immutable snapshot to
 * challenge_versions ("saber qué decía el reto en cualquier momento") and one
 * audit row, in the same transaction as the write.
 */
export async function updateChallenge(
  challengeId: number,
  editorId: number,
  patch: UpdateChallengeBody,
) {
  if (patch.judgingPanelCriteria !== undefined && (await panelIsLocked())) {
    throw new ConflictError("Judging panel is locked: judging has already started", {
      code: "panel_locked",
    });
  }

  return withTransaction(async (client) => {
    const { rows: currentRows } = await client.query(
      `SELECT ${EDITABLE_COLUMNS} FROM challenges WHERE id = $1 FOR UPDATE`,
      [challengeId],
    );
    const before = currentRows[0];
    if (!before) throw new NotFoundError("Challenge not found", { challengeId });

    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    const put = (col: string, val: unknown, cast = "") => {
      sets.push(`${col} = $${i}${cast}`);
      values.push(val);
      i += 1;
    };

    if (patch.title !== undefined) put("title", patch.title);
    if (patch.description !== undefined) put("description", patch.description);
    if (patch.criteria !== undefined) put("criteria", patch.criteria);
    if (patch.prizes !== undefined)
      put("prizes", patch.prizes === null ? null : JSON.stringify(patch.prizes), "::jsonb");
    if (patch.judgingPanelCriteria !== undefined)
      put("judging_panel_criteria", JSON.stringify(patch.judgingPanelCriteria), "::jsonb");
    if (patch.maxPresentationSeconds !== undefined)
      put("max_presentation_seconds", patch.maxPresentationSeconds);

    values.push(challengeId);
    const { rows: updatedRows } = await client.query(
      `UPDATE challenges SET ${sets.join(", ")} WHERE id = $${i} RETURNING ${EDITABLE_COLUMNS}`,
      values,
    );
    const after = updatedRows[0];

    const snapshot = {
      title: after.title,
      description: after.description,
      criteria: after.criteria,
      prizes: after.prizes,
      judging_panel_criteria: after.judging_panel_criteria,
      max_presentation_seconds: after.max_presentation_seconds,
    };
    await client.query(
      `INSERT INTO challenge_versions (challenge_id, editor_id, snapshot)
       VALUES ($1, $2, $3::jsonb)`,
      [challengeId, editorId, JSON.stringify(snapshot)],
    );

    await audit(client, {
      actorId: editorId,
      entityType: "challenge",
      entityId: challengeId,
      action: "updated",
      before: {
        title: before.title,
        judging_panel_criteria: before.judging_panel_criteria,
      },
      after: { title: after.title, fields: Object.keys(patch) },
    });

    return after;
  });
}

export async function listVersions(challengeId: number) {
  const { rows } = await pool.query(
    `SELECT v.id, v.editor_id, v.snapshot, v.created_at, u.name, u.surname
       FROM challenge_versions v
       LEFT JOIN users u ON u.id = v.editor_id
      WHERE v.challenge_id = $1
      ORDER BY v.created_at DESC, v.id DESC`,
    [challengeId],
  );
  return rows;
}

/**
 * Render the judging panel for preview (H44). Returns the typed questions plus
 * whether the panel is still editable and when it freezes.
 */
export async function previewPanel(challengeId: number) {
  const challenge = await getChallenge(challengeId);
  const raw = challenge.judging_panel_criteria;
  const questions: Question[] = Array.isArray(raw) ? raw : [];
  const startsAt = await judgingStartsAt();
  return {
    challengeId,
    title: challenge.title,
    questions,
    locked: startsAt !== null && Date.now() >= startsAt.getTime(),
    judgingStartsAt: startsAt ? startsAt.toISOString() : null,
  };
}
