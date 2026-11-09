import { CAPABILITIES } from "@hackos/shared/capabilities";
import { ERROR_REASONS } from "@hackos/shared/error-reasons";
import type {
  AvailabilityInterval,
  HelperCard,
  HelpTopic,
  HelperDetail as SharedHelperDetail,
  MyHelperProfile as SharedMyHelperProfile,
} from "@hackos/shared/help-desk";
import type { FastifyRequest } from "fastify";
import type { Queryable } from "../../db/pool.js";
import { pool, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { getRequestAuthorizationContext, userHasCapability } from "../../lib/capabilities.js";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors.js";
import { photoUrl } from "../../lib/profile-files.js";
import { type DirectoryEntry, helperProfileEntry, OWN_CV_PATH } from "../directory/service.js";
import { highestVisibleRoleNameSql } from "../identity/role.js";
import type { AvailabilityInput, HelperProfileInput } from "./schemas.js";
import { assertTopicsExist } from "./topics.js";

/**
 * H61-H63 helper profiles. A helper card projects the person's existing
 * identity (users) and public profile (user_public_profiles: headline, bio,
 * surname and photo switches) — nothing is copied, so the bio is the same on
 * both profiles. Publication here is independent of public-profile sharing
 * (#934): it makes the card browsable and is the consent that shows the
 * person's public profile (`HelperDetail.profile`, the directory's own entry)
 * to help desk readers.
 */

export type { AvailabilityInterval, HelperCard, HelpTopic } from "@hackos/shared/help-desk";
export type HelperKind = HelperCard["kind"];
export type HelperDetail = SharedHelperDetail<DirectoryEntry>;
export type MyHelperProfile = SharedMyHelperProfile<DirectoryEntry>;

/** Capabilities that may browse published helpers (H63). */
export const HELPDESK_BROWSE = [
  CAPABILITIES.HELPDESK_REQUEST,
  CAPABILITIES.HELPDESK_OFFER,
  CAPABILITIES.HELPDESK_COVERAGE,
] as const;

export async function mayBrowseHelpers(req: FastifyRequest): Promise<boolean> {
  const context = getRequestAuthorizationContext(req);
  for (const capability of HELPDESK_BROWSE) {
    if (await userHasCapability(context, capability)) return true;
  }
  return false;
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
  ${highestVisibleRoleNameSql("u.id")} AS visible_role_name,
  (SELECT e.name FROM sponsors s JOIN enterprises e ON e.id = s.enterprise_id
    WHERE s.user_id = u.id ORDER BY s.joined_at, s.id LIMIT 1) AS affiliation,
  (SELECT e.logo_url FROM sponsors s JOIN enterprises e ON e.id = s.enterprise_id
    WHERE s.user_id = u.id ORDER BY s.joined_at, s.id LIMIT 1) AS affiliation_logo_url,
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
  visible_role_name: string | null;
  affiliation: string | null;
  affiliation_logo_url: string | null;
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
    visibleRoleName: row.visible_role_name,
    affiliation: row.affiliation,
    affiliationLogoUrl: row.affiliation_logo_url,
    topics: row.topics.map((t) => ({ id: Number(t.id), name: t.name })),
    availability: row.availability.map((a) => ({
      startsAt: iso(a.startsAt),
      endsAt: iso(a.endsAt),
    })),
    scheduledNow: row.scheduled_now,
    present: row.present,
    availableNow: row.present,
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
  const [card, profile, eligible, challenges, challengeOptions, suggestedInterval] =
    await Promise.all([
      readOwnCard(db, userId),
      db.query<{ published: boolean; published_at: Date | null }>(
        "SELECT published, published_at FROM helper_profiles WHERE user_id = $1",
        [userId],
      ),
      isEligibleHelper(db, userId),
      namedHelperChallenges(db, userId),
      eventChallengeOptions(db),
      suggestedAvailability(db),
    ]);
  const row = profile.rows[0];
  // H63: exactly what others get from GET /api/helpdesk/helpers/:id, even
  // unpublished; only the CV route is the owner's own.
  const preview = {
    ...toCard(card),
    challenges,
    profile: await helperProfileEntry(db, userId, OWN_CV_PATH),
  };
  return {
    eligible,
    published: row?.published ?? false,
    publishedAt: row?.published_at ? row.published_at.toISOString() : null,
    bio: preview.bio,
    topics: preview.topics,
    availability: preview.availability,
    suggestedInterval,
    challengeIds: challenges.map((c) => c.id),
    challenges,
    challengeOptions: eligible ? challengeOptions : [],
    preview,
  };
}

/**
 * H62: the interval clients prefill for a new availability entry: the hacking
 * window, else the event window, else null.
 */
async function suggestedAvailability(db: Queryable): Promise<AvailabilityInterval | null> {
  const { rows } = await db.query<{ starts_at: Date | null; ends_at: Date | null }>(
    `SELECT CASE WHEN hacking_starts_at IS NOT NULL AND hacking_ends_at IS NOT NULL
                 THEN hacking_starts_at ELSE event_starts_at END AS starts_at,
            CASE WHEN hacking_starts_at IS NOT NULL AND hacking_ends_at IS NOT NULL
                 THEN hacking_ends_at ELSE event_ends_at END AS ends_at
       FROM event_config WHERE id = 1`,
  );
  const row = rows[0];
  if (!row?.starts_at || !row.ends_at) return null;
  return { startsAt: row.starts_at.toISOString(), endsAt: row.ends_at.toISOString() };
}

/** H65: the challenges a helper chose to be alerted about, named, by name. */
async function namedHelperChallenges(
  db: Queryable,
  userId: number,
): Promise<{ id: number; name: string }[]> {
  const { rows } = await db.query<{ id: number; title: string }>(
    `SELECT c.id, c.title FROM helper_profile_challenges hc
       JOIN challenges c ON c.id = hc.challenge_id
      WHERE hc.user_id = $1 ORDER BY lower(c.title), c.id`,
    [userId],
  );
  return rows.map((r) => ({ id: Number(r.id), name: r.title }));
}

/**
 * H65: the challenges a helper may choose from, the same set a help request
 * may be about (visible, non-test).
 */
async function eventChallengeOptions(db: Queryable): Promise<{ id: number; name: string }[]> {
  const { rows } = await db.query<{ id: number; title: string }>(
    `SELECT id, title FROM challenges
      WHERE visibility = 'visible' AND is_test_account = false
      ORDER BY lower(title), id`,
  );
  return rows.map((r) => ({ id: Number(r.id), name: r.title }));
}

/**
 * H65: challenge ids a helper limited their alerts and inbox to, or null when
 * they see every request (no challenges chosen).
 */
export async function challengeLimit(db: Queryable, userId: number): Promise<number[] | null> {
  const { rows } = await db.query<{ challenge_id: number }>(
    "SELECT challenge_id FROM helper_profile_challenges WHERE user_id = $1 ORDER BY challenge_id",
    [userId],
  );
  return rows.length > 0 ? rows.map((r) => Number(r.challenge_id)) : null;
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
 * H61: publish/unpublish and choose topics. The bio is edited only in the
 * public profile editor.
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

    const beforeChallenges = (await challengeLimit(client, userId)) ?? [];
    let challengeIds = beforeChallenges;
    if (input.challengeIds !== undefined) {
      challengeIds = [...new Set(input.challengeIds)].sort((a, b) => a - b);
      if (challengeIds.length > 0) {
        const { rows } = await client.query<{ id: number }>(
          `SELECT id FROM challenges
            WHERE id = ANY($1::int[]) AND visibility = 'visible' AND is_test_account = false`,
          [challengeIds],
        );
        const known = new Set(rows.map((r) => Number(r.id)));
        const unknown = challengeIds.filter((c) => !known.has(c));
        if (unknown.length > 0) {
          throw new BadRequestError("Choose challenges of the event", {
            challengeIds: unknown,
          });
        }
      }
    }

    const changedFields: string[] = [];
    // H61: turning the helper publication on also shares the public profile
    // (never undone by unpublishing).
    const shares = input.published && !current.published;
    if (current.published !== input.published) changedFields.push("published");
    if (shares) changedFields.push("directoryVisible");
    if (beforeChallenges.join(",") !== challengeIds.join(",")) changedFields.push("challengeIds");
    if (beforeTopics.join(",") !== topicIds.join(",")) changedFields.push("topics");
    if (changedFields.length === 0) return false;

    await client.query(
      `UPDATE helper_profiles
          SET published = $2, published_at = CASE WHEN $2 AND NOT published THEN now() ELSE published_at END
        WHERE user_id = $1`,
      [userId, input.published],
    );
    if (shares) {
      await client.query(
        `INSERT INTO user_public_profiles (user_id, directory_visible, consented_at)
         VALUES ($1, true, now())
         ON CONFLICT (user_id) DO UPDATE SET
           directory_visible = true,
           consented_at = CASE WHEN user_public_profiles.directory_visible
                               THEN user_public_profiles.consented_at ELSE now() END`,
        [userId],
      );
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
    if (changedFields.includes("challengeIds")) {
      await client.query("DELETE FROM helper_profile_challenges WHERE user_id = $1", [userId]);
      if (challengeIds.length > 0) {
        await client.query(
          "INSERT INTO helper_profile_challenges (user_id, challenge_id) SELECT $1, unnest($2::int[])",
          [userId, challengeIds],
        );
      }
    }
    // H53: field names, topic ids and challenge ids only.
    await audit(client, {
      actorId: userId,
      entityType: "helper_profile",
      entityId: userId,
      action: "updated",
      before: {
        published: current.published,
        topicIds: beforeTopics,
        challengeIds: beforeChallenges,
      },
      after: { published: input.published, topicIds, challengeIds, changedFields },
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
    // H62: nobody can state availability before the window clients prefill
    // (the hacking time, else the event); no window, no restriction.
    const window = await suggestedAvailability(client);
    const first = intervals[0];
    if (window && first && first.startsAt < new Date(window.startsAt)) {
      throw new BadRequestError("Availability cannot start before the hacking time", {
        code: ERROR_REASONS.AVAILABILITY_BEFORE_WINDOW,
        windowStartsAt: window.startsAt,
      });
    }
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
    where.push(presentSql("u.id"));
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

const LISTED_HELPER_SQL = `
  FROM helper_profiles hp
  JOIN users u ON u.id = hp.user_id
  LEFT JOIN user_public_profiles pp ON pp.user_id = u.id
 WHERE ${LISTED_HELPER_WHERE}`;

/** Whether `userId` is a helper browsers can see (published, eligible, active). */
export async function isListedHelper(db: Queryable, userId: number): Promise<boolean> {
  const { rows } = await db.query(`SELECT 1 ${LISTED_HELPER_SQL} AND u.id = $1`, [userId]);
  return rows.length > 0;
}

/**
 * H64, H66: the requester and active team members of a request a helper
 * claimed (or resolved) may open that helper's profile even if the helper was
 * unpublished since. Knowing an id grants nothing: it needs the claim.
 */
export async function claimedForViewer(
  db: Queryable,
  viewerId: number,
  helperId: number,
): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM help_requests hr
      WHERE hr.claimed_by = $2 AND hr.status IN ('claimed', 'resolved')
        AND (hr.requester_id = $1 OR (hr.repo_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM submissions s WHERE s.repo_id = hr.repo_id AND s.user_id = $1
             AND s.status = 'active')))
      LIMIT 1`,
    [viewerId, helperId],
  );
  return rows.length > 0;
}

/**
 * Whether the caller may open `helperId`'s profile, photo and CV: a browser
 * of a listed helper, or a viewer of a request that helper claimed.
 */
export async function mayOpenHelper(
  req: FastifyRequest,
  db: Queryable,
  helperId: number,
): Promise<boolean> {
  if ((await mayBrowseHelpers(req)) && (await isListedHelper(db, helperId))) return true;
  return claimedForViewer(db, req.userId as number, helperId);
}

/**
 * Whether `viewerId` may open `requesterId`'s photo and CV through a help
 * request: a notified recipient or the claimer of one of their requests
 * (a helper limited to some challenges only through those, or ones they
 * claimed), or `helpdesk:manage`. The profile's own sharing switches are
 * applied by the caller.
 */
export async function mayOpenRequester(
  req: FastifyRequest,
  db: Queryable,
  requesterId: number,
): Promise<boolean> {
  const viewerId = req.userId as number;
  if (await userHasCapability(getRequestAuthorizationContext(req), CAPABILITIES.HELPDESK_MANAGE))
    return true;
  const limit = await challengeLimit(db, viewerId);
  const { rows } = await db.query(
    `SELECT 1 FROM help_requests hr
      WHERE hr.requester_id = $2
        AND (hr.claimed_by = $1 OR EXISTS (
              SELECT 1 FROM help_request_recipients rr
               WHERE rr.request_id = hr.id AND rr.user_id = $1))
        AND ($3::int[] IS NULL OR hr.claimed_by = $1 OR hr.challenge_id = ANY($3::int[]))
      LIMIT 1`,
    [viewerId, requesterId, limit],
  );
  return rows.length > 0;
}

/**
 * H63: the card plus the person's public profile, from the directory's own
 * entry. The caller has already checked `mayOpenHelper`.
 */
export async function getHelper(userId: number): Promise<HelperDetail> {
  const { rows } = await pool.query<CardRow>(
    `SELECT ${CARD_COLUMNS}
       FROM users u LEFT JOIN user_public_profiles pp ON pp.user_id = u.id
      WHERE u.id = $1 AND u.anonymized_at IS NULL`,
    [userId],
  );
  if (!rows[0]) throw new NotFoundError("Helper not found");
  return {
    ...toCard(rows[0]),
    profile: await helperProfileEntry(pool, userId),
    challenges: await namedHelperChallenges(pool, userId),
  };
}

/** Photo route: whether the person's photo switch is on (access is `mayOpenHelper`). */
export async function helperPhotoShown(db: Queryable, userId: number): Promise<boolean> {
  const { rows } = await db.query(
    "SELECT 1 FROM user_public_profiles WHERE user_id = $1 AND show_photo",
    [userId],
  );
  return rows.length > 0;
}
