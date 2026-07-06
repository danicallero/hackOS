import type { Question } from "@hackos/shared/questions";
import type { Queryable } from "../../db/pool.js";
import { pool, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors.js";
import type { ChallengeAccess } from "./access.js";
import {
  CHALLENGE_GENERAL_FIELDS,
  type CreateChallengeBody,
  type PublishChallengeBody,
  type UpdateChallengeBody,
} from "./schemas.js";

/** Publicly visible challenges are frozen for sponsor owners (admins keep editing). */
function isFrozenForOwner(visibility: string): boolean {
  return visibility === "visible";
}

/** Snapshot of the editable surface, written to challenge_versions on every change. */
function snapshotOf(row: Record<string, unknown>) {
  return {
    title: row.title,
    description: row.description,
    criteria: row.criteria,
    prizes: row.prizes,
    judging_panel_criteria: row.judging_panel_criteria,
    max_presentation_seconds: row.max_presentation_seconds,
  };
}

const EDITABLE_COLUMNS = `id, title, description, criteria, prizes,
  judging_panel_criteria, max_presentation_seconds, visibility,
  available_from, created_at, updated_at`;

const EDITABLE_COLUMNS_FROM_CHALLENGE = `c.id, c.title, c.description, c.criteria, c.prizes,
  c.judging_panel_criteria, c.max_presentation_seconds, c.visibility,
  c.available_from, c.created_at, c.updated_at`;

const CREATE_RETURNING_COLUMNS = `id, author, title, description, criteria, prizes,
  judging_panel_criteria, max_presentation_seconds, visibility,
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
    `SELECT ${EDITABLE_COLUMNS_FROM_CHALLENGE}
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

async function ensureEnterpriseSponsorAnchor(db: Queryable, enterpriseId: number): Promise<number> {
  const enterprise = await db.query(`SELECT id FROM enterprises WHERE id = $1`, [enterpriseId]);
  if (!enterprise.rows[0]) throw new NotFoundError("Enterprise not found", { enterpriseId });

  const existing = await db.query(
    `SELECT id
       FROM sponsors
      WHERE enterprise_id = $1
      ORDER BY (user_id IS NOT NULL), id
      LIMIT 1`,
    [enterpriseId],
  );
  if (existing.rows[0]) return Number(existing.rows[0].id);

  const created = await db.query(
    `INSERT INTO sponsors (enterprise_id, user_id) VALUES ($1, NULL) RETURNING id`,
    [enterpriseId],
  );
  return Number(created.rows[0].id);
}

/** Admin-created challenge template bound to an enterprise (H43/H44). */
export async function createChallenge(input: CreateChallengeBody, actorId: number) {
  return withTransaction(async (client) => {
    const authorId = await ensureEnterpriseSponsorAnchor(client, input.enterpriseId);
    const { rows } = await client.query(
      `INSERT INTO challenges
         (author, title, description, criteria, prizes, judging_panel_criteria,
          max_presentation_seconds, visibility)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, 'hidden')
       RETURNING ${CREATE_RETURNING_COLUMNS}`,
      [
        authorId,
        input.title,
        input.description ?? "",
        input.criteria ?? null,
        input.prizes === undefined ? null : JSON.stringify(input.prizes),
        input.judgingPanelCriteria === undefined
          ? null
          : JSON.stringify(input.judgingPanelCriteria),
        input.maxPresentationSeconds ?? null,
      ],
    );
    const created = rows[0];

    await client.query(
      `INSERT INTO challenge_versions (challenge_id, editor_id, snapshot)
       VALUES ($1, $2, $3::jsonb)`,
      [created.id, actorId, JSON.stringify(snapshotOf(created))],
    );

    await audit(client, {
      actorId,
      entityType: "challenge",
      entityId: created.id,
      action: "created",
      after: {
        enterpriseId: input.enterpriseId,
        title: created.title,
        visibility: created.visibility,
      },
    });

    return created;
  });
}

/**
 * Admin-only reveal to the public catalog (H45). Makes the challenge visible,
 * optionally on a schedule: the public route stays quiet until `availableFrom`.
 */
export async function publishChallenge(
  challengeId: number,
  actorId: number,
  input: PublishChallengeBody,
) {
  return withTransaction(async (client) => {
    const beforeRes = await client.query(
      `SELECT ${EDITABLE_COLUMNS} FROM challenges WHERE id = $1 FOR UPDATE`,
      [challengeId],
    );
    const before = beforeRes.rows[0];
    if (!before) throw new NotFoundError("Challenge not found", { challengeId });

    const availableFrom = input.availableFrom ?? null;
    const updated = await client.query(
      `UPDATE challenges
          SET visibility = 'visible',
              available_from = $2,
              updated_at = now()
        WHERE id = $1
        RETURNING ${EDITABLE_COLUMNS}`,
      [challengeId, availableFrom],
    );
    const after = updated.rows[0];

    await client.query(
      `INSERT INTO challenge_versions (challenge_id, editor_id, snapshot)
       VALUES ($1, $2, $3::jsonb)`,
      [challengeId, actorId, JSON.stringify(snapshotOf(after))],
    );

    await audit(client, {
      actorId,
      entityType: "challenge",
      entityId: challengeId,
      action: "published",
      before: { visibility: before.visibility, available_from: before.available_from },
      after: { visibility: after.visibility, available_from: after.available_from },
    });

    return after;
  });
}

/** Admin-only hide for correcting accidental reveals (H45). */
export async function unpublishChallenge(challengeId: number, actorId: number) {
  return withTransaction(async (client) => {
    const beforeRes = await client.query(
      `SELECT ${EDITABLE_COLUMNS} FROM challenges WHERE id = $1 FOR UPDATE`,
      [challengeId],
    );
    const before = beforeRes.rows[0];
    if (!before) throw new NotFoundError("Challenge not found", { challengeId });

    const updated = await client.query(
      `UPDATE challenges
          SET visibility = 'hidden',
              updated_at = now()
        WHERE id = $1
        RETURNING ${EDITABLE_COLUMNS}`,
      [challengeId],
    );
    const after = updated.rows[0];

    await client.query(
      `INSERT INTO challenge_versions (challenge_id, editor_id, snapshot)
       VALUES ($1, $2, $3::jsonb)`,
      [challengeId, actorId, JSON.stringify(snapshotOf(after))],
    );

    await audit(client, {
      actorId,
      entityType: "challenge",
      entityId: challengeId,
      action: "unpublished",
      before: { visibility: before.visibility },
      after: { visibility: after.visibility },
    });

    return after;
  });
}

/**
 * Admin-only bulk visibility flip (H45). Making challenges visible reveals them
 * immediately (clears any pending schedule); hiding pulls them from the public
 * route. Each challenge is audited; unknown ids are ignored.
 */
export async function setChallengesVisibility(
  challengeIds: number[],
  visible: boolean,
  actorId: number,
) {
  if (challengeIds.length === 0) return { updated: [] as number[] };
  return withTransaction(async (client) => {
    const visibility = visible ? "visible" : "hidden";
    const { rows } = await client.query(
      `UPDATE challenges
          SET visibility = $2,
              available_from = CASE WHEN $2 = 'visible' THEN NULL ELSE available_from END,
              updated_at = now()
        WHERE id = ANY($1::int[])
        RETURNING id`,
      [challengeIds, visibility],
    );
    for (const row of rows) {
      await audit(client, {
        actorId,
        entityType: "challenge",
        entityId: Number(row.id),
        action: visible ? "published" : "unpublished",
        after: { visibility },
      });
    }
    return { updated: rows.map((r) => Number(r.id)) };
  });
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
  access: ChallengeAccess = "owner",
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

    const touchesGeneralField = CHALLENGE_GENERAL_FIELDS.some(
      (field) => patch[field] !== undefined,
    );
    if (access === "owner" && isFrozenForOwner(before.visibility) && touchesGeneralField) {
      throw new ForbiddenError("Visible challenges can only be edited by admins", {
        challengeId,
        visibility: before.visibility,
      });
    }

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

    await client.query(
      `INSERT INTO challenge_versions (challenge_id, editor_id, snapshot)
       VALUES ($1, $2, $3::jsonb)`,
      [challengeId, editorId, JSON.stringify(snapshotOf(after))],
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
