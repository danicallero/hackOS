import { CAPABILITIES } from "@hackos/shared/capabilities";
import { ERROR_REASONS } from "@hackos/shared/error-reasons";
import type { Queryable } from "../../db/pool.js";
import { pool, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors.js";
import { photoUrl } from "../../lib/profile-files.js";
import type { AvailabilityInput, HelperProfileInput } from "./schemas.js";
import { assertTopicsExist } from "./topics.js";

/**
 * H61-H63 helper profiles. A helper card projects the person's existing
 * identity (users) and public profile (user_public_profiles: headline, bio,
 * surname and photo switches) — nothing is copied, so the bio is the same on
 * both profiles. Publication here is independent of public-profile sharing
 * (#934): it only makes the help desk card browsable.
 */

export type HelperKind = "mentor" | "sponsor" | "staff";

export interface HelpTopic {
  id: number;
  name: string;
}

export interface AvailabilityInterval {
  startsAt: string;
  endsAt: string;
}

export interface HelperCard {
  userId: number;
  displayName: string;
  photoUrl: string | null;
  headline: string | null;
  bio: string | null;
  kind: HelperKind;
  affiliation: string | null;
  topics: HelpTopic[];
  availability: AvailabilityInterval[];
  scheduledNow: boolean;
  present: boolean;
  availableNow: boolean;
}

export interface MyHelperProfile {
  eligible: boolean;
  published: boolean;
  publishedAt: string | null;
  bio: string | null;
  topics: HelpTopic[];
  availability: AvailabilityInterval[];
  preview: HelperCard;
}

const OFFER_CAPABILITIES = `ARRAY['${CAPABILITIES.HELPDESK_OFFER}', '${CAPABILITIES.ADMIN_ALL}']`;

/**
 * H61 eligibility for `userRef` (an SQL expression yielding a user id): the
 * person holds `helpdesk:offer` now, or an accepted/confirmed application
 * response to a form whose granted role carries it. Accepted mentors receive
 * the Mentor role only on confirmation (applications/service.ts), and H61 lets
 * them prepare their profile right after acceptance.
 */
export function eligibleSql(userRef: string): string {
  return `(
    EXISTS (SELECT 1 FROM user_effective_capabilities ec
             WHERE ec.user_id = ${userRef} AND ec.capability = ANY(${OFFER_CAPABILITIES}))
    OR EXISTS (
      SELECT 1 FROM application_responses ar
        JOIN application_grants_roles agr ON agr.application_id = ar.application_id
        JOIN roles gr ON gr.id = agr.role_id AND gr.deleted_at IS NULL
        JOIN role_capabilities grc ON grc.role_id = gr.id AND grc.state = 'allow'
             AND grc.capability = ANY(${OFFER_CAPABILITIES})
       WHERE ar.user_id = ${userRef} AND ar.status IN ('accepted', 'confirmed'))
  )`;
}

/** H24 presence: the person's latest door scan (not in the future) is an entry. */
export function presentSql(userRef: string): string {
  return `COALESCE((
    SELECT tl.kind = 'in' FROM time_logs tl
     WHERE tl.user_id = ${userRef} AND tl.scanned_at <= now()
     ORDER BY tl.scanned_at DESC, tl.id DESC LIMIT 1), false)`;
}

/** H62: inside one of the person's stated intervals right now. */
export function scheduledNowSql(userRef: string): string {
  return `EXISTS (SELECT 1 FROM helper_availability ha
                   WHERE ha.user_id = ${userRef} AND ha.starts_at <= now() AND ha.ends_at > now())`;
}

/**
 * Helpers browsers can see: published, eligible, active and real (review
 * fixtures stay out of every listing, like public profiles).
 */
export const LISTED_HELPER_WHERE = `
  hp.published
  AND u.account_state = 'active' AND u.anonymized_at IS NULL
  AND u.is_test_account = false
  AND ${eligibleSql("u.id")}`;

/** Display category: sponsor > mentor > staff; binds `u`. */
export const KIND_SQL = `
  CASE
    WHEN EXISTS (SELECT 1 FROM sponsors s WHERE s.user_id = u.id) THEN 'sponsor'
    WHEN EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
                  WHERE ur.user_id = u.id AND r.name = 'Mentor' AND r.deleted_at IS NULL)
      OR EXISTS (SELECT 1 FROM application_responses ar
                   JOIN application_grants_roles agr ON agr.application_id = ar.application_id
                   JOIN roles r ON r.id = agr.role_id AND r.name = 'Mentor' AND r.deleted_at IS NULL
                  WHERE ar.user_id = u.id AND ar.status IN ('accepted', 'confirmed'))
      THEN 'mentor'
    ELSE 'staff'
  END`;

/** Display name with the public profile's surname switch (#934 rule). */
export const DISPLAY_NAME_SQL = `btrim(
  u.name || CASE
    WHEN NULLIF(btrim(u.surname), '') IS NULL THEN ''
    WHEN COALESCE(pp.show_surname, false) THEN ' ' || btrim(u.surname)
    ELSE ' ' || left(btrim(u.surname), 1) || '.'
  END)`;

/** Columns of one card; binds `u` (users), `pp` (public profile, may be NULL). */
export const CARD_COLUMNS = `
  u.id AS user_id,
  ${DISPLAY_NAME_SQL} AS display_name,
  CASE WHEN COALESCE(pp.show_photo, false) THEN u.photo_key END AS photo_key,
  pp.headline,
  pp.bio,
  ${KIND_SQL} AS kind,
  (SELECT e.name FROM sponsors s JOIN enterprises e ON e.id = s.enterprise_id
    WHERE s.user_id = u.id ORDER BY s.joined_at, s.id LIMIT 1) AS affiliation,
  COALESCE((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) ORDER BY lower(t.name), t.id)
              FROM helper_topics ht JOIN help_topics t ON t.id = ht.topic_id
             WHERE ht.user_id = u.id), '[]'::jsonb) AS topics,
  COALESCE((SELECT jsonb_agg(jsonb_build_object('startsAt', ha.starts_at, 'endsAt', ha.ends_at)
                             ORDER BY ha.starts_at, ha.id)
              FROM helper_availability ha WHERE ha.user_id = u.id), '[]'::jsonb) AS availability,
  ${scheduledNowSql("u.id")} AS scheduled_now,
  ${presentSql("u.id")} AS present`;

export interface CardRow {
  user_id: number;
  display_name: string;
  photo_key: string | null;
  headline: string | null;
  bio: string | null;
  kind: HelperKind;
  affiliation: string | null;
  topics: HelpTopic[];
  availability: { startsAt: string; endsAt: string }[];
  scheduled_now: boolean;
  present: boolean;
}

const iso = (value: string) => new Date(value).toISOString();

export function toCard(row: CardRow): HelperCard {
  const userId = Number(row.user_id);
  return {
    userId,
    displayName: row.display_name,
    photoUrl: photoUrl(userId, row.photo_key),
    headline: row.headline,
    bio: row.bio,
    kind: row.kind,
    affiliation: row.affiliation,
    topics: row.topics.map((t) => ({ id: Number(t.id), name: t.name })),
    availability: row.availability.map((a) => ({
      startsAt: iso(a.startsAt),
      endsAt: iso(a.endsAt),
    })),
    scheduledNow: row.scheduled_now,
    present: row.present,
    availableNow: row.scheduled_now && row.present,
  };
}

export async function isEligibleHelper(db: Queryable, userId: number): Promise<boolean> {
  const { rows } = await db.query<{ ok: boolean }>(`SELECT ${eligibleSql("$1::int")} AS ok`, [
    userId,
  ]);
  return rows[0]?.ok === true;
}

async function assertEligible(db: Queryable, userId: number): Promise<void> {
  if (!(await isEligibleHelper(db, userId))) {
    throw new ForbiddenError("Only mentors, sponsor representatives and staff can offer help", {
      code: ERROR_REASONS.HELPER_NOT_ELIGIBLE,
    });
  }
}

async function readOwnCard(db: Queryable, userId: number): Promise<CardRow> {
  const { rows } = await db.query<CardRow>(
    `SELECT ${CARD_COLUMNS}
       FROM users u
       LEFT JOIN user_public_profiles pp ON pp.user_id = u.id
      WHERE u.id = $1`,
    [userId],
  );
  if (!rows[0]) throw new NotFoundError("User not found");
  return rows[0];
}

export async function getMyHelperProfile(
  userId: number,
  db: Queryable = pool,
): Promise<MyHelperProfile> {
  const [card, profile, eligible] = await Promise.all([
    readOwnCard(db, userId),
    db.query<{ published: boolean; published_at: Date | null }>(
      "SELECT published, published_at FROM helper_profiles WHERE user_id = $1",
      [userId],
    ),
    isEligibleHelper(db, userId),
  ]);
  const preview = toCard(card);
  const row = profile.rows[0];
  return {
    eligible,
    published: row?.published ?? false,
    publishedAt: row?.published_at ? row.published_at.toISOString() : null,
    bio: preview.bio,
    topics: preview.topics,
    availability: preview.availability,
    preview,
  };
}

/** Lock the caller's users row: H54 removal takes the same lock. */
async function lockActiveUser(db: Queryable, userId: number): Promise<void> {
  const { rows } = await db.query(
    `SELECT 1 FROM users WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL
      FOR UPDATE`,
    [userId],
  );
  if (!rows[0]) {
    throw new ConflictError("This account is being removed", { code: "account_removal_pending" });
  }
}

async function ensureProfileRow(db: Queryable, userId: number) {
  await db.query(
    "INSERT INTO helper_profiles (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING",
    [userId],
  );
  const { rows } = await db.query<{ published: boolean }>(
    "SELECT published FROM helper_profiles WHERE user_id = $1 FOR UPDATE",
    [userId],
  );
  return rows[0] as { published: boolean };
}

/**
 * H61: publish/unpublish, choose topics and edit the shared bio. The bio is
 * written to user_public_profiles (creating a hidden profile row when the
 * person has none, without touching its sharing consent).
 */
export async function updateMyHelperProfile(
  userId: number,
  input: HelperProfileInput,
): Promise<{ changed: boolean; profile: MyHelperProfile }> {
  const changed = await withTransaction(async (client) => {
    await lockActiveUser(client, userId);
    await assertEligible(client, userId);
    const topicIds = [...new Set(input.topicIds)].sort((a, b) => a - b);
    await assertTopicsExist(client, topicIds);
    const current = await ensureProfileRow(client, userId);
    const { rows: topicRows } = await client.query<{ topic_id: number }>(
      "SELECT topic_id FROM helper_topics WHERE user_id = $1 ORDER BY topic_id",
      [userId],
    );
    const beforeTopics = topicRows.map((r) => Number(r.topic_id));
    const { rows: bioRows } = await client.query<{ bio: string | null }>(
      "SELECT bio FROM user_public_profiles WHERE user_id = $1 FOR UPDATE",
      [userId],
    );
    const beforeBio = bioRows[0]?.bio ?? null;
    const nextBio = input.bio === undefined ? beforeBio : input.bio;
    if (input.published && topicIds.length === 0) {
      throw new ConflictError("Choose at least one topic before publishing", {
        code: ERROR_REASONS.HELPER_PROFILE_INCOMPLETE,
      });
    }

    const changedFields: string[] = [];
    if (current.published !== input.published) changedFields.push("published");
    if (beforeTopics.join(",") !== topicIds.join(",")) changedFields.push("topics");
    if (beforeBio !== nextBio) changedFields.push("bio");
    if (changedFields.length === 0) return false;

    if (changedFields.includes("published")) {
      await client.query(
        `UPDATE helper_profiles
            SET published = $2, published_at = CASE WHEN $2 THEN now() ELSE published_at END
          WHERE user_id = $1`,
        [userId, input.published],
      );
    } else {
      await client.query("UPDATE helper_profiles SET updated_at = now() WHERE user_id = $1", [
        userId,
      ]);
    }
    if (changedFields.includes("topics")) {
      await client.query("DELETE FROM helper_topics WHERE user_id = $1", [userId]);
      if (topicIds.length > 0) {
        await client.query(
          "INSERT INTO helper_topics (user_id, topic_id) SELECT $1, unnest($2::int[])",
          [userId, topicIds],
        );
      }
    }
    if (changedFields.includes("bio")) {
      await client.query(
        `INSERT INTO user_public_profiles (user_id, bio) VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET bio = EXCLUDED.bio`,
        [userId, nextBio],
      );
    }
    // H53: field names and topic ids only, never the bio text.
    await audit(client, {
      actorId: userId,
      entityType: "helper_profile",
      entityId: userId,
      action: "updated",
      before: { published: current.published, topicIds: beforeTopics },
      after: { published: input.published, topicIds, changedFields },
    });
    return true;
  });
  return { changed, profile: await getMyHelperProfile(userId) };
}

const MAX_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** H62: replace the stated schedule. Intervals must not overlap. */
export async function replaceMyAvailability(
  userId: number,
  input: AvailabilityInput,
): Promise<{ changed: boolean; profile: MyHelperProfile }> {
  const intervals = input.intervals
    .map((i) => ({ startsAt: new Date(i.startsAt), endsAt: new Date(i.endsAt) }))
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  for (const [index, interval] of intervals.entries()) {
    const length = interval.endsAt.getTime() - interval.startsAt.getTime();
    if (length <= 0 || length > MAX_INTERVAL_MS) {
      throw new BadRequestError(
        "Each interval must end after it starts and last at most 24 hours",
        {
          code: ERROR_REASONS.AVAILABILITY_INVALID,
        },
      );
    }
    const previous = intervals[index - 1];
    if (previous && previous.endsAt > interval.startsAt) {
      throw new BadRequestError("Availability intervals must not overlap", {
        code: ERROR_REASONS.AVAILABILITY_OVERLAP,
      });
    }
  }
  const changed = await withTransaction(async (client) => {
    await lockActiveUser(client, userId);
    await assertEligible(client, userId);
    await ensureProfileRow(client, userId);
    const { rows } = await client.query<{ starts_at: Date; ends_at: Date }>(
      "SELECT starts_at, ends_at FROM helper_availability WHERE user_id = $1 ORDER BY starts_at, id",
      [userId],
    );
    const key = (list: { startsAt: Date; endsAt: Date }[]) =>
      list.map((i) => `${i.startsAt.toISOString()}/${i.endsAt.toISOString()}`).join(",");
    const before = rows.map((r) => ({ startsAt: r.starts_at, endsAt: r.ends_at }));
    if (key(before) === key(intervals)) return false;
    await client.query("DELETE FROM helper_availability WHERE user_id = $1", [userId]);
    if (intervals.length > 0) {
      await client.query(
        `INSERT INTO helper_availability (user_id, starts_at, ends_at)
         SELECT $1, s, e FROM unnest($2::timestamptz[], $3::timestamptz[]) AS x(s, e)`,
        [userId, intervals.map((i) => i.startsAt), intervals.map((i) => i.endsAt)],
      );
    }
    await client.query("UPDATE helper_profiles SET updated_at = now() WHERE user_id = $1", [
      userId,
    ]);
    await audit(client, {
      actorId: userId,
      entityType: "helper_profile",
      entityId: userId,
      action: "availability_updated",
      before: { intervals: before.length },
      after: { intervals: intervals.length },
    });
    return true;
  });
  return { changed, profile: await getMyHelperProfile(userId) };
}

export interface HelperFilter {
  topicId?: number;
  q?: string;
  availableNow?: boolean;
}

/** H63: published helpers, available now first, then by name. */
export async function listHelpers(filter: HelperFilter): Promise<HelperCard[]> {
  const params: unknown[] = [];
  const where = [LISTED_HELPER_WHERE];
  if (filter.topicId !== undefined) {
    params.push(filter.topicId);
    where.push(
      `EXISTS (SELECT 1 FROM helper_topics ft WHERE ft.user_id = u.id AND ft.topic_id = $${params.length})`,
    );
  }
  if (filter.q) {
    params.push(`%${filter.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    const p = `$${params.length}`;
    where.push(`(
      unaccent(u.name || ' ' || COALESCE(u.surname, '')) ILIKE unaccent(${p})
      OR EXISTS (SELECT 1 FROM helper_topics qt JOIN help_topics t ON t.id = qt.topic_id
                  WHERE qt.user_id = u.id AND unaccent(t.name) ILIKE unaccent(${p})))`);
  }
  if (filter.availableNow) {
    where.push(`${scheduledNowSql("u.id")} AND ${presentSql("u.id")}`);
  }
  const { rows } = await pool.query<CardRow>(
    `SELECT ${CARD_COLUMNS}
       FROM helper_profiles hp
       JOIN users u ON u.id = hp.user_id
       LEFT JOIN user_public_profiles pp ON pp.user_id = u.id
      WHERE ${where.join(" AND ")}`,
    params,
  );
  return rows
    .map(toCard)
    .sort(
      (a, b) =>
        Number(b.availableNow) - Number(a.availableNow) ||
        a.displayName.localeCompare(b.displayName) ||
        a.userId - b.userId,
    );
}

export async function getHelper(userId: number): Promise<HelperCard> {
  const { rows } = await pool.query<CardRow>(
    `SELECT ${CARD_COLUMNS}
       FROM helper_profiles hp
       JOIN users u ON u.id = hp.user_id
       LEFT JOIN user_public_profiles pp ON pp.user_id = u.id
      WHERE ${LISTED_HELPER_WHERE} AND u.id = $1`,
    [userId],
  );
  if (!rows[0]) throw new NotFoundError("Helper not found");
  return toCard(rows[0]);
}

/** Photo route: a listed helper's photo, while their photo switch is on. */
export async function photoPublishedInHelpDesk(db: Queryable, userId: number): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM helper_profiles hp
       JOIN users u ON u.id = hp.user_id
       JOIN user_public_profiles pp ON pp.user_id = u.id
      WHERE ${LISTED_HELPER_WHERE} AND pp.show_photo AND u.id = $1`,
    [userId],
  );
  return rows.length > 0;
}
