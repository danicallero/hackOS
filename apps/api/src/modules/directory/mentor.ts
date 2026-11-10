import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { Queryable } from "../../db/pool.js";
import { pool, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { AppError, ConflictError, NotFoundError } from "../../lib/errors.js";
import { currentEventKey } from "../event/context.js";

/**
 * Mentor/helper profile (onboarding contract §5). Person-scoped, published per
 * event. Eligibility is only the effective `helpdesk:offer` capability (the
 * wildcard counts): no role, attendance-kind or networking prerequisite.
 * Losing the capability never deletes rows; the profile just stops being
 * offered and listed, and reappears unchanged if the capability returns.
 */
export const MENTOR_NOT_ELIGIBLE = "mentor_profile_not_eligible";

export interface MentorProfile {
  eligible: boolean;
  published: boolean;
  /** The person's knowledge topics (the help desk catalogue), which is what a scan shows. */
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

/**
 * The stored profile with its eligibility. Expertise is the person's help desk
 * knowledge topics, edited with the helper profile (one catalogue, H61).
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
    `SELECT t.id, t.name AS label
       FROM helper_topics ht
       JOIN help_topics t ON t.id = ht.topic_id
      WHERE ht.user_id = $1
      ORDER BY lower(t.name), t.id`,
    [userId],
  );
  return {
    eligible: head[0].eligible,
    published: head[0].published === true,
    expertise,
  };
}

export interface MentorProfileInput {
  published: boolean;
}

export interface MentorActor {
  actorId: number;
  source: "web" | "admin";
}

/**
 * Sets whether the person's mentor profile is published for the current event.
 * `changed` is false when the request repeats the stored state. Not eligible: 403
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
    const before = await readMentorProfile(db, userId);
    if (before.published === input.published) return { changed: false, profile: before };

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
    // Field names only, never the chosen values (R033).
    await audit(db, {
      actorId: actor.actorId,
      entityType: "mentor_profile",
      entityId: userId,
      action: "mentor_profile.updated",
      source: actor.source,
      before: { published: before.published },
      after: { published: input.published },
      changedFields: ["published"],
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
              SELECT array_agg(t.name ORDER BY lower(t.name), t.id)
                FROM helper_topics ht
                JOIN help_topics t ON t.id = ht.topic_id
               WHERE ht.user_id = m.user_id), '{}') AS expertise
       FROM mentor_profiles m JOIN users u ON u.id = m.user_id
      WHERE m.user_id = $1 AND m.event_key = $2 AND m.published
        AND u.is_test_account = false AND ${MENTOR_ELIGIBLE_SQL}`,
    [userId, eventKey],
  );
  return rows[0] ? { expertise: rows[0].expertise } : null;
}
