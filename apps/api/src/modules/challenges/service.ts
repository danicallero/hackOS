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

type TranslationMap = Record<string, string>;

/** Publicly visible challenges are frozen for sponsor owners (admins keep editing). */
function isFrozenForOwner(visibility: string): boolean {
  return visibility === "visible";
}

/** Snapshot of the editable surface, written to challenge_versions on every change. */
function snapshotOf(row: Record<string, unknown>) {
  return {
    title: row.title,
    title_i18n: row.title_i18n,
    description: row.description,
    description_i18n: row.description_i18n,
    criteria: row.criteria,
    criteria_i18n: row.criteria_i18n,
    prizes: row.prizes,
    devpost_tags: row.devpost_tags,
    judging_panel_criteria: row.judging_panel_criteria,
    max_presentation_seconds: row.max_presentation_seconds,
    max_in_waiting_area: row.max_in_waiting_area,
    visibility: row.visibility,
    available_from: row.available_from,
  };
}

const EDITABLE_COLUMNS = `id, title, title_i18n, description, description_i18n, criteria,
  criteria_i18n, prizes, devpost_tags, judging_panel_criteria, max_presentation_seconds,
  max_in_waiting_area, visibility, available_from, created_at, updated_at`;

const EDITABLE_COLUMNS_FROM_CHALLENGE = `c.id, c.title, c.title_i18n, c.description,
  c.description_i18n, c.criteria, c.criteria_i18n, c.prizes, c.devpost_tags, c.judging_panel_criteria,
  c.max_presentation_seconds, c.max_in_waiting_area, c.visibility, c.available_from,
  c.created_at, c.updated_at`;

const CREATE_RETURNING_COLUMNS = `id, author, title, title_i18n, description, description_i18n,
  criteria, criteria_i18n, prizes, devpost_tags, judging_panel_criteria, max_presentation_seconds,
  max_in_waiting_area, visibility, available_from, created_at, updated_at`;

function translationsOf(i18n: unknown, fallback: string | null): TranslationMap {
  const translations: TranslationMap = {};
  if (i18n && typeof i18n === "object" && !Array.isArray(i18n)) {
    for (const [locale, value] of Object.entries(i18n as Record<string, unknown>)) {
      if (typeof value === "string" && value.trim()) translations[locale] = value;
    }
  }
  if (Object.keys(translations).length === 0 && fallback?.trim()) translations.en = fallback;
  return translations;
}

function challengeReadModel(row: Record<string, unknown>) {
  return {
    ...row,
    id: Number(row.id),
    title: translationsOf(row.title_i18n, String(row.title ?? "")),
    description: translationsOf(row.description_i18n, String(row.description ?? "")),
    criteria: translationsOf(row.criteria_i18n, (row.criteria as string | null) ?? null),
  };
}

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
  return challengeReadModel(rows[0]);
}

export async function listDevpostPrizes() {
  const { rows } = await pool.query(
    `SELECT dp.name, dp.last_batch, COUNT(rdp.repo_id)::int AS repo_count,
            MIN(c.id) FILTER (WHERE c.id IS NOT NULL) AS mapped_challenge_id,
            MIN(c.title) FILTER (WHERE c.id IS NOT NULL) AS mapped_challenge_title
       FROM devpost_prizes dp
       LEFT JOIN repo_devpost_prizes rdp ON rdp.prize = dp.name
       LEFT JOIN challenges c ON c.devpost_tags ? dp.name
      GROUP BY dp.name, dp.last_batch
      ORDER BY dp.name ASC`,
  );
  return rows.map(
    (row: {
      name: string;
      last_batch: string | null;
      repo_count: string | number;
      mapped_challenge_id: number | null;
      mapped_challenge_title: string | null;
    }) => ({
      name: row.name,
      lastBatch: row.last_batch,
      repoCount: Number(row.repo_count ?? 0),
      mappedChallengeId: row.mapped_challenge_id ? Number(row.mapped_challenge_id) : null,
      mappedChallengeTitle: row.mapped_challenge_title ?? null,
    }),
  );
}

/** Challenges owned by the enterprise `userId` is a sponsor of (H44/H46). */
export async function listOwnedChallenges(userId: number) {
  const { rows } = await pool.query(
    `SELECT ${EDITABLE_COLUMNS_FROM_CHALLENGE}, ent.name AS enterprise_name
       FROM challenges c
       JOIN sponsors author ON author.id = c.author
       JOIN enterprises ent ON ent.id = author.enterprise_id
       JOIN sponsors mine ON mine.enterprise_id = author.enterprise_id
      WHERE mine.user_id = $1
      ORDER BY c.id`,
    [userId],
  );
  return rows.map(challengeReadModel);
}

/** Challenges assigned to a user through room_judges (H46 contextual judge access). */
export async function listAssignedJudgeChallenges(userId: number) {
  const { rows } = await pool.query(
    `SELECT DISTINCT ${EDITABLE_COLUMNS_FROM_CHALLENGE}, ent.name AS enterprise_name
       FROM room_judges rj
       JOIN challenges c ON c.id = rj.challenge_id
       JOIN sponsors author ON author.id = c.author
       JOIN enterprises ent ON ent.id = author.enterprise_id
      WHERE rj.user_id = $1
      ORDER BY c.id`,
    [userId],
  );
  return rows.map(challengeReadModel);
}

export async function listAllChallenges() {
  const { rows } = await pool.query(
    `SELECT ${EDITABLE_COLUMNS_FROM_CHALLENGE}, ent.name AS enterprise_name
       FROM challenges c
       JOIN sponsors author ON author.id = c.author
       JOIN enterprises ent ON ent.id = author.enterprise_id
      ORDER BY c.id`,
  );
  return rows.map(challengeReadModel);
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
    // title/criteria stay in sync with their i18n .en so plain-string consumers
    // (queue, projects, exports) keep working.
    const title = input.titleI18n?.en.trim() || input.title;
    const description = input.descriptionI18n
      ? input.descriptionI18n.en
      : (input.description ?? "");
    const criteria = input.criteriaI18n
      ? input.criteriaI18n.en.trim() || null
      : (input.criteria ?? null);
    const { rows } = await client.query(
      `INSERT INTO challenges
         (author, title, title_i18n, description, description_i18n, criteria, criteria_i18n,
          prizes, devpost_tags, judging_panel_criteria, max_presentation_seconds, max_in_waiting_area,
          visibility, available_from)
       VALUES ($1, $2, $3::jsonb, $4, $5::jsonb, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, $11, $12,
               'hidden', $13)
       RETURNING ${CREATE_RETURNING_COLUMNS}`,
      [
        authorId,
        title,
        input.titleI18n ? JSON.stringify(input.titleI18n) : null,
        description,
        input.descriptionI18n ? JSON.stringify(input.descriptionI18n) : null,
        criteria,
        input.criteriaI18n ? JSON.stringify(input.criteriaI18n) : null,
        input.prizes === undefined ? null : JSON.stringify(input.prizes),
        input.devpostTags === undefined ? JSON.stringify([]) : JSON.stringify(input.devpostTags),
        input.judgingPanelCriteria === undefined
          ? null
          : JSON.stringify(input.judgingPanelCriteria),
        input.maxPresentationSeconds ?? null,
        input.maxInWaitingArea ?? 2,
        input.availableFrom ?? null,
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
 * Admin-only reveal to the public catalog (H45). Makes the challenge visible.
 * `availableFrom` is retained only as the scheduler trigger timestamp; it does
 * not hide an already-visible challenge.
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

/**
 * Admin-only hide (H45). Also clears any pending reveal (available_from), so a
 * hidden challenge never carries a stale schedule — this doubles as the
 * "remove schedule" action for an already-hidden challenge.
 */
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
              available_from = NULL,
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
 * immediately; hiding pulls them from the public route. `available_from` is a
 * trigger, not a visibility filter, so bulk changes leave it untouched.
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
    if (access === "owner" && patch.availableFrom !== undefined) {
      throw new ForbiddenError("Challenge reveal scheduling can only be edited by admins", {
        challengeId,
      });
    }
    if (access === "owner" && patch.visibility !== undefined) {
      throw new ForbiddenError("Challenge visibility can only be edited by admins", {
        challengeId,
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

    // title/criteria mirror their i18n .en so plain-string consumers keep working.
    if (patch.titleI18n !== undefined) {
      put(
        "title_i18n",
        patch.titleI18n === null ? null : JSON.stringify(patch.titleI18n),
        "::jsonb",
      );
      put("title", patch.titleI18n?.en.trim() || before.title);
    } else if (patch.title !== undefined) {
      put("title", patch.title);
    }
    if (patch.descriptionI18n !== undefined) {
      put(
        "description_i18n",
        patch.descriptionI18n === null ? null : JSON.stringify(patch.descriptionI18n),
        "::jsonb",
      );
      put("description", patch.descriptionI18n ? patch.descriptionI18n.en : "");
    } else if (patch.description !== undefined) {
      put("description", patch.description);
    }
    if (patch.criteriaI18n !== undefined) {
      put(
        "criteria_i18n",
        patch.criteriaI18n === null ? null : JSON.stringify(patch.criteriaI18n),
        "::jsonb",
      );
      put("criteria", patch.criteriaI18n ? patch.criteriaI18n.en.trim() || null : null);
    } else if (patch.criteria !== undefined) {
      put("criteria", patch.criteria);
    }
    if (patch.prizes !== undefined)
      put("prizes", patch.prizes === null ? null : JSON.stringify(patch.prizes), "::jsonb");
    if (patch.devpostTags !== undefined)
      put(
        "devpost_tags",
        patch.devpostTags === null ? "[]" : JSON.stringify(patch.devpostTags),
        "::jsonb",
      );
    if (patch.judgingPanelCriteria !== undefined)
      put("judging_panel_criteria", JSON.stringify(patch.judgingPanelCriteria), "::jsonb");
    if (patch.maxPresentationSeconds !== undefined)
      put("max_presentation_seconds", patch.maxPresentationSeconds);
    if (patch.maxInWaitingArea !== undefined) put("max_in_waiting_area", patch.maxInWaitingArea);
    if (patch.visibility !== undefined) put("visibility", patch.visibility);
    if (patch.availableFrom !== undefined) put("available_from", patch.availableFrom ?? null);

    values.push(challengeId);
    const { rows: updatedRows } = await client.query(
      `UPDATE challenges SET ${sets.join(", ")} WHERE id = $${i} RETURNING ${EDITABLE_COLUMNS}`,
      values,
    );
    const after = updatedRows[0];

    if (patch.maxInWaitingArea !== undefined) {
      await client.query(
        `UPDATE room_queue_state rqs
            SET max_in_waiting_area = $2
           FROM room_challenges rc
          WHERE rc.room_id = rqs.room_id
            AND rc.challenge_id = $1`,
        [challengeId, patch.maxInWaitingArea],
      );
    }

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

/**
 * Scheduled visibility sweep (H45). `available_from` is only a trigger: due
 * hidden rows flip visible, while already-visible rows remain visible even if
 * their timestamp is in the future.
 */
export async function revealDueChallenges(client: Queryable = pool): Promise<number[]> {
  const { rows } = await client.query(
    `UPDATE challenges
        SET visibility = 'visible',
            available_from = NULL,
            updated_at = now()
      WHERE visibility = 'hidden'
        AND available_from IS NOT NULL
        AND available_from <= now()
      RETURNING id`,
  );
  return rows.map((r: { id: number }) => Number(r.id));
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
  const { rows } = await pool.query(
    `SELECT title, judging_panel_criteria FROM challenges WHERE id = $1`,
    [challengeId],
  );
  const challenge = rows[0];
  if (!challenge) throw new NotFoundError("Challenge not found", { challengeId });
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
