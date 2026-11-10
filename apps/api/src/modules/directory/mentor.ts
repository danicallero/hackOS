import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { Queryable } from "../../db/pool.js";
import { pool, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { AppError, BadRequestError, ConflictError, NotFoundError } from "../../lib/errors.js";
import { currentEventKey } from "../event/context.js";

/**
 * Mentor/helper profile (onboarding contract §5). Person-scoped, published per
 * event. Eligibility is only the effective `helpdesk:offer` capability (the
 * wildcard counts): no role, attendance-kind or networking prerequisite.
 * Losing the capability never deletes rows; the profile just stops being
 * offered and listed, and reappears unchanged if the capability returns.
 */
export const MENTOR_EXPERTISE_FIELD = "mentor_expertise";
export const MENTOR_NOT_ELIGIBLE = "mentor_profile_not_eligible";

export interface MentorProfile {
  eligible: boolean;
  published: boolean;
  /** The profile-scope expertise catalogue, read through /api/form-libraries/:id. */
  libraryId: string | null;
  expertise: { id: number; label: string }[];
}

/** Effective holders of the capability, as a set-based fragment over `u` (users). */
export const MENTOR_ELIGIBLE_SQL = `EXISTS (
  SELECT 1 FROM user_effective_capabilities c
   WHERE c.user_id = u.id AND c.capability IN ('${CAPABILITIES.HELPDESK_OFFER}', '${CAPABILITIES.ADMIN_ALL}'))`;

export async function isMentorEligible(db: Queryable, userId: number): Promise<boolean> {
  const { rows } = await db.query<{ eligible: boolean }>(
    `SELECT ${MENTOR_ELIGIBLE_SQL} AS eligible FROM users u WHERE u.id = $1`,
    [userId],
  );
  return rows[0]?.eligible === true;
}

async function mentorLibraryId(db: Queryable): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM form_libraries WHERE profile AND field_key = $1`,
    [MENTOR_EXPERTISE_FIELD],
  );
  return rows[0]?.id ?? null;
}

/**
 * The stored profile with its eligibility. Expertise is the catalogue values
 * of the caller's fixture boundary, like every library read.
 */
export async function readMentorProfile(db: Queryable, userId: number): Promise<MentorProfile> {
  const eventKey = await currentEventKey(db);
  const { rows: head } = await db.query<{ eligible: boolean; published: boolean | null }>(
    `SELECT ${MENTOR_ELIGIBLE_SQL} AS eligible,
            (SELECT m.published FROM mentor_profiles m WHERE m.user_id = u.id AND m.event_key = $2) AS published
       FROM users u WHERE u.id = $1 AND u.anonymized_at IS NULL`,
    [userId, eventKey],
  );
  if (!head[0]) throw new NotFoundError("User not found");
  const { rows: expertise } = await db.query<{ id: number; label: string }>(
    `SELECT v.id, v.name AS label
       FROM mentor_profile_expertise e
       JOIN form_library_values v ON v.id = e.library_value_id
      WHERE e.user_id = $1 AND e.event_key = $2
      ORDER BY lower(v.name), v.id`,
    [userId, eventKey],
  );
  return {
    eligible: head[0].eligible,
    published: head[0].published === true,
    libraryId: await mentorLibraryId(db),
    expertise,
  };
}

export interface MentorProfileInput {
  published: boolean;
  expertiseIds: number[];
}

export interface MentorActor {
  actorId: number;
  source: "web" | "admin";
}

/**
 * Replaces the person's mentor profile for the current event. `changed` is
 * false when the request repeats the stored state. Not eligible: 403
 * `mentor_profile_not_eligible`, the stored data untouched.
 */
export async function writeMentorProfile(
  userId: number,
  input: MentorProfileInput,
  actor: MentorActor,
): Promise<{ changed: boolean; profile: MentorProfile }> {
  return withTransaction(async (db) => {
    const { rows: owner } = await db.query<{ account_state: string; is_test_account: boolean }>(
      `SELECT account_state, is_test_account FROM users
        WHERE id = $1 AND anonymized_at IS NULL FOR NO KEY UPDATE`,
      [userId],
    );
    if (!owner[0]) throw new NotFoundError("User not found");
    if (owner[0].account_state === "removal_pending")
      throw new ConflictError("This account is being removed");
    if (!(await isMentorEligible(db, userId)))
      throw new AppError(
        403,
        "forbidden",
        "The mentor profile needs the permission to offer help",
        { code: MENTOR_NOT_ELIGIBLE },
      );

    const eventKey = await currentEventKey(db);
    const ids = [...new Set(input.expertiseIds)].sort((a, b) => a - b);
    if (ids.length) {
      const { rows } = await db.query(
        `SELECT 1 FROM form_library_values v JOIN form_libraries l ON l.id = v.library_id
          WHERE l.profile AND l.field_key = $2 AND v.is_test_account = $3 AND v.id = ANY($1::int[])`,
        [ids, MENTOR_EXPERTISE_FIELD, owner[0].is_test_account],
      );
      if (rows.length !== ids.length) throw new BadRequestError("Unknown expertise value");
    }

    const before = await readMentorProfile(db, userId);
    const beforeIds = before.expertise.map((item) => item.id).sort((a, b) => a - b);
    const publishedChanged = before.published !== input.published;
    const expertiseChanged = JSON.stringify(beforeIds) !== JSON.stringify(ids);
    if (!publishedChanged && !expertiseChanged) return { changed: false, profile: before };

    await db.query(
      `INSERT INTO mentor_profiles (user_id, event_key, published, published_at)
       VALUES ($1, $2, $3, CASE WHEN $3 THEN now() END)
       ON CONFLICT (user_id, event_key) DO UPDATE SET
         published = EXCLUDED.published,
         published_at = CASE
           WHEN EXCLUDED.published AND NOT mentor_profiles.published THEN now()
           ELSE mentor_profiles.published_at END,
         updated_at = now()`,
      [userId, eventKey, input.published],
    );
    if (expertiseChanged) {
      await db.query(`DELETE FROM mentor_profile_expertise WHERE user_id = $1 AND event_key = $2`, [
        userId,
        eventKey,
      ]);
      if (ids.length)
        await db.query(
          `INSERT INTO mentor_profile_expertise (user_id, event_key, library_value_id)
           SELECT $1, $2, unnest($3::int[])`,
          [userId, eventKey, ids],
        );
    }
    // Field names only, never the chosen values (R033).
    await audit(db, {
      actorId: actor.actorId,
      entityType: "mentor_profile",
      entityId: userId,
      action: "mentor_profile.updated",
      source: actor.source,
      before: { published: before.published },
      after: { published: input.published },
      changedFields: [
        ...(publishedChanged ? ["published"] : []),
        ...(expertiseChanged ? ["expertise"] : []),
      ],
    });
    return { changed: true, profile: await readMentorProfile(db, userId) };
  });
}

export async function getMentorProfile(userId: number): Promise<MentorProfile> {
  return readMentorProfile(pool, userId);
}

/**
 * What a scanner may read about a published, still-eligible mentor: the
 * expertise labels only, independent of the networking opt-in. Null otherwise.
 */
export async function readPublishedMentor(
  db: Queryable,
  userId: number,
): Promise<{ expertise: string[] } | null> {
  const eventKey = await currentEventKey(db);
  const { rows } = await db.query<{ expertise: string[] }>(
    `SELECT COALESCE((
              SELECT array_agg(v.name ORDER BY lower(v.name), v.id)
                FROM mentor_profile_expertise e
                JOIN form_library_values v ON v.id = e.library_value_id
               WHERE e.user_id = m.user_id AND e.event_key = m.event_key), '{}') AS expertise
       FROM mentor_profiles m JOIN users u ON u.id = m.user_id
      WHERE m.user_id = $1 AND m.event_key = $2 AND m.published
        AND u.is_test_account = false AND ${MENTOR_ELIGIBLE_SQL}`,
    [userId, eventKey],
  );
  return rows[0] ? { expertise: rows[0].expertise } : null;
}
