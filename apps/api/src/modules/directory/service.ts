import type { Queryable } from "../../db/pool.js";
import { pool, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors.js";
import { photoUrl } from "../../lib/profile-files.js";
import { hasEventAccess } from "../identity/role.js";
import type { DirectoryQuery, PublicProfileInput, SocialLink } from "./schemas.js";

/**
 * People directory (#934, #935). Every field a reader can see is listed in
 * `entrySql`; anything else about a person (email, badge, intolerances,
 * roles, presence, teammates, storage keys) never leaves this module.
 */
export interface DirectoryEntry {
  userId: number;
  displayName: string;
  /** Authenticated photo route; the object itself is private. */
  photoUrl: string | null;
  headline: string | null;
  bio: string | null;
  locationNote: string | null;
  socials: SocialLink[];
  /** Authenticated CV route, only while the person shares it. */
  cvUrl: string | null;
  project: { kind: "project" | "workGroup"; id: number; name: string } | null;
  challenges: { id: number; name: string }[];
}

interface EntryRow {
  user_id: number;
  display_name: string;
  sort_key: string;
  photo_key: string | null;
  headline: string | null;
  bio: string | null;
  location_note: string | null;
  socials: SocialLink[];
  has_cv: boolean;
  project: DirectoryEntry["project"];
  challenges: DirectoryEntry["challenges"];
}

/**
 * Fragments over `p` (user_public_profiles) and `u` (users). The project is the
 * active repository submission, falling back to an unlinked planned work
 * group; challenges are the published ones that project or group still takes
 * part in (cancelled/disqualified queue entries excluded, as in
 * projects/lifecycle.ts). Both are suppressed when show_project is off.
 */
const SHOWN_REPO_SQL = `
  SELECT r.id, r.name
    FROM submissions s
    JOIN repos r ON r.id = s.repo_id
   WHERE p.show_project
     AND s.user_id = u.id
     AND s.status = 'active'
     AND r.is_test_account = false
   ORDER BY r.id
   LIMIT 1`;

const SHOWN_GROUP_SQL = `
  SELECT g.id, g.name
    FROM planned_work_group_members m
    JOIN planned_work_groups g ON g.id = m.group_id
   WHERE p.show_project
     AND NOT EXISTS (${SHOWN_REPO_SQL})
     AND m.user_id = u.id
     AND m.status = 'active'
     AND g.linked_repo_id IS NULL
   ORDER BY g.id
   LIMIT 1`;

/** `c` is a published challenge the given repo/group expressions take part in. */
function challengeOfProject(repoId: string, groupId: string): string {
  return `c.visibility = 'visible'
    AND c.is_test_account = false
    AND (
      EXISTS (
        SELECT 1 FROM queue_entries qe
         WHERE qe.challenge_id = c.id
           AND qe.repo_id = ${repoId}
           AND qe.status NOT IN ('cancelled', 'disqualified')
      )
      OR EXISTS (
        SELECT 1 FROM planned_work_group_challenges gc
         WHERE gc.challenge_id = c.id AND gc.group_id = ${groupId}
      )
    )`;
}

const DISPLAY_NAME_JOIN = `
  CROSS JOIN LATERAL (
    SELECT btrim(
             u.name || CASE
               WHEN NULLIF(btrim(u.surname), '') IS NULL THEN ''
               WHEN p.show_surname THEN ' ' || btrim(u.surname)
               ELSE ' ' || left(btrim(u.surname), 1) || '.'
             END
           ) AS display_name
  ) e`;

/**
 * Every field a reader can see. `profiles` is the FROM item that binds `p`:
 * the stored table, the paged CTE joined to it, or the owner's unsaved preview.
 */
function entrySql(profiles: string): string {
  return `
  SELECT u.id AS user_id,
         e.display_name,
         lower(unaccent(e.display_name)) AS sort_key,
         CASE WHEN p.show_photo THEN u.photo_key END AS photo_key,
         p.headline,
         p.bio,
         p.location_note,
         p.socials,
         (p.share_cv AND p.cv_key IS NOT NULL) AS has_cv,
         CASE
           WHEN repo.id IS NOT NULL THEN jsonb_build_object('kind', 'project', 'id', repo.id, 'name', repo.name)
           WHEN grp.id IS NOT NULL THEN jsonb_build_object('kind', 'workGroup', 'id', grp.id, 'name', grp.name)
         END AS project,
         COALESCE((
           SELECT jsonb_agg(jsonb_build_object('id', c.id, 'name', c.title) ORDER BY c.title, c.id)
             FROM challenges c
            WHERE ${challengeOfProject("repo.id", "grp.id")}
         ), '[]'::jsonb) AS challenges
    FROM ${profiles}
    JOIN users u ON u.id = p.user_id
    ${DISPLAY_NAME_JOIN}
    LEFT JOIN LATERAL (${SHOWN_REPO_SQL}) repo ON true
    LEFT JOIN LATERAL (${SHOWN_GROUP_SQL}) grp ON true`;
}

/** Directory universe: opted in, admitted to the event, never a test account. */
const VISIBLE_WHERE = `
  p.directory_visible
  AND u.is_test_account = false
  AND EXISTS (SELECT 1 FROM user_event_access a WHERE a.user_id = u.id)`;

/** `cvPath` differs for the owner's preview, who may not read the directory. */
function toEntry(row: EntryRow, cvPath = `/api/directory/${row.user_id}/cv`): DirectoryEntry {
  const userId = Number(row.user_id);
  return {
    userId,
    displayName: row.display_name,
    photoUrl: photoUrl(userId, row.photo_key),
    headline: row.headline,
    bio: row.bio,
    locationNote: row.location_note,
    socials: row.socials.map(({ kind, url }) => ({ kind, url })),
    cvUrl: row.has_cv ? cvPath : null,
    project: row.project ? { ...row.project, id: Number(row.project.id) } : null,
    challenges: row.challenges.map((c) => ({ id: Number(c.id), name: c.name })),
  };
}

/**
 * Whether `userId`'s photo is published to directory readers: the same
 * universe as the listing, with the photo switch on (#934).
 */
export async function photoPublishedInDirectory(db: Queryable, userId: number): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM user_public_profiles p JOIN users u ON u.id = p.user_id
      WHERE ${VISIBLE_WHERE} AND p.show_photo AND u.id = $1`,
    [userId],
  );
  return rows.length > 0;
}

async function assertReaderAdmitted(userId: number): Promise<void> {
  if (!(await hasEventAccess(pool, userId))) {
    throw new ForbiddenError("The people directory is only available to event attendees");
  }
}

function encodeCursor(row: EntryRow): string {
  return Buffer.from(JSON.stringify([row.sort_key, Number(row.user_id)])).toString("base64url");
}

function decodeCursor(cursor: string): [string, number] {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (
      Array.isArray(value) &&
      value.length === 2 &&
      typeof value[0] === "string" &&
      Number.isSafeInteger(value[1])
    ) {
      return [value[0], value[1] as number];
    }
  } catch {
    // Fall through to the explicit business error below.
  }
  throw new BadRequestError("Invalid directory cursor");
}

function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

export async function listDirectory(
  readerId: number,
  query: DirectoryQuery,
): Promise<{ items: DirectoryEntry[]; nextCursor: string | null }> {
  await assertReaderAdmitted(readerId);
  const params: unknown[] = [];
  const filters = [VISIBLE_WHERE];
  if (query.q) {
    params.push(likePattern(query.q));
    filters.push(`unaccent(e.display_name) ILIKE unaccent($${params.length})`);
  }
  if (query.challengeId) {
    params.push(query.challengeId);
    filters.push(`EXISTS (
      SELECT 1 FROM challenges c
       WHERE c.id = $${params.length}
         AND ${challengeOfProject(
           `(SELECT shown.id FROM (${SHOWN_REPO_SQL}) shown)`,
           `(SELECT shown.id FROM (${SHOWN_GROUP_SQL}) shown)`,
         )})`);
  }
  if (query.cursor) {
    const [sortKey, userId] = decodeCursor(query.cursor);
    params.push(sortKey, userId);
    filters.push(
      `(lower(unaccent(e.display_name)), p.user_id) > ($${params.length - 1}::text, $${params.length}::int)`,
    );
  }
  params.push(query.limit + 1);
  // Page over the visible ids first; only the page gets the project and
  // challenge projections. Both orderings use the same (sort_key, user_id).
  const { rows } = await pool.query<EntryRow>(
    `WITH page AS (
       SELECT p.user_id, lower(unaccent(e.display_name)) AS sort_key
         FROM user_public_profiles p
         JOIN users u ON u.id = p.user_id
         ${DISPLAY_NAME_JOIN}
        WHERE ${filters.join(" AND ")}
        ORDER BY sort_key, p.user_id
        LIMIT $${params.length}
     )
     ${entrySql("page JOIN user_public_profiles p ON p.user_id = page.user_id")}
     ORDER BY page.sort_key, page.user_id`,
    params,
  );
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page.map((row) => toEntry(row)),
    nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null,
  };
}

/** Hidden and missing profiles are deliberately indistinguishable (#934). */
export async function getDirectoryEntry(readerId: number, userId: number): Promise<DirectoryEntry> {
  await assertReaderAdmitted(readerId);
  const { rows } = await pool.query<EntryRow>(
    `${entrySql("user_public_profiles p")} WHERE ${VISIBLE_WHERE} AND u.id = $1`,
    [userId],
  );
  if (!rows[0]) throw new NotFoundError("Person not found");
  return toEntry(rows[0]);
}

/**
 * The shared CV of an opted-in person (#935). Hidden profiles, a CV that is
 * not shared and a missing CV all answer the same 404.
 */
export async function getDirectoryCv(
  readerId: number,
  userId: number,
): Promise<{ key: string; filename: string }> {
  await assertReaderAdmitted(readerId);
  const { rows } = await pool.query<{ cv_key: string; cv_filename: string }>(
    `SELECT p.cv_key, p.cv_filename
       FROM user_public_profiles p JOIN users u ON u.id = p.user_id
      WHERE ${VISIBLE_WHERE} AND p.share_cv AND p.cv_key IS NOT NULL AND u.id = $1`,
    [userId],
  );
  if (!rows[0]) throw new NotFoundError("Person not found");
  return { key: rows[0].cv_key, filename: rows[0].cv_filename };
}

/**
 * Live cards of the given people that are visible right now, keyed by user id
 * (#935 event diary). Anyone hidden, missing or no longer admitted is simply
 * absent, exactly as in the directory itself; no reader gate is applied here.
 */
export async function visibleDirectoryEntries(
  db: Queryable,
  userIds: number[],
): Promise<Map<number, DirectoryEntry>> {
  if (userIds.length === 0) return new Map();
  const { rows } = await db.query<EntryRow>(
    `${entrySql("user_public_profiles p")} WHERE ${VISIBLE_WHERE} AND u.id = ANY($1::int[])`,
    [userIds],
  );
  return new Map(rows.map((row) => [Number(row.user_id), toEntry(row)]));
}

interface ProfileRow {
  directory_visible: boolean;
  show_surname: boolean;
  show_photo: boolean;
  show_project: boolean;
  headline: string | null;
  bio: string | null;
  location_note: string | null;
  socials: SocialLink[];
  share_cv: boolean;
  cv_key: string | null;
  cv_filename: string | null;
  cv_uploaded_at: Date | null;
  consented_at: Date | null;
}

const DEFAULT_PROFILE: ProfileRow = {
  directory_visible: false,
  show_surname: false,
  show_photo: false,
  show_project: true,
  headline: null,
  bio: null,
  location_note: null,
  socials: [],
  share_cv: false,
  cv_key: null,
  cv_filename: null,
  cv_uploaded_at: null,
  consented_at: null,
};

/** Owner preview: the card exactly as readers would see it if visible. */
async function preview(db: Queryable, userId: number, profile: ProfileRow) {
  const { rows } = await db.query<EntryRow>(
    `WITH p AS (
       SELECT $1::int AS user_id, $2::boolean AS show_surname, $3::boolean AS show_photo,
              $4::boolean AS show_project, $5::text AS headline, $6::text AS location_note,
              $7::text AS bio, $8::jsonb AS socials, $9::boolean AS share_cv, $10::text AS cv_key
     )
     ${entrySql("p")} WHERE u.id = $1`,
    [
      userId,
      profile.show_surname,
      profile.show_photo,
      profile.show_project,
      profile.headline,
      profile.location_note,
      profile.bio,
      JSON.stringify(profile.socials),
      profile.share_cv,
      profile.cv_key,
    ],
  );
  if (!rows[0]) throw new NotFoundError("User not found");
  return toEntry(rows[0], "/api/me/public-profile/cv");
}

async function presentProfile(db: Queryable, userId: number, profile: ProfileRow) {
  return {
    directoryVisible: profile.directory_visible,
    showSurname: profile.show_surname,
    showPhoto: profile.show_photo,
    showProject: profile.show_project,
    headline: profile.headline,
    bio: profile.bio,
    locationNote: profile.location_note,
    socials: profile.socials.map(({ kind, url }) => ({ kind, url })),
    shareCv: profile.share_cv,
    cv:
      profile.cv_filename && profile.cv_uploaded_at
        ? { filename: profile.cv_filename, uploadedAt: profile.cv_uploaded_at.toISOString() }
        : null,
    consentedAt: profile.consented_at ? profile.consented_at.toISOString() : null,
    preview: await preview(db, userId, profile),
  };
}

const PROFILE_COLUMNS = `directory_visible, show_surname, show_photo, show_project, headline, bio,
  location_note, socials, share_cv, cv_key, cv_filename, cv_uploaded_at, consented_at`;

async function readProfile(db: Queryable, userId: number, lock = false): Promise<ProfileRow> {
  const { rows } = await db.query<ProfileRow>(
    `SELECT ${PROFILE_COLUMNS} FROM user_public_profiles WHERE user_id = $1${lock ? " FOR UPDATE" : ""}`,
    [userId],
  );
  return rows[0] ?? DEFAULT_PROFILE;
}

export async function getMyPublicProfile(userId: number) {
  await assertReaderAdmitted(userId);
  return presentProfile(pool, userId, await readProfile(pool, userId));
}

type ProfileSettings = Required<PublicProfileInput>;

const FIELD_COLUMNS = {
  directoryVisible: "directory_visible",
  showSurname: "show_surname",
  showPhoto: "show_photo",
  showProject: "show_project",
  headline: "headline",
  bio: "bio",
  locationNote: "location_note",
  socials: "socials",
  shareCv: "share_cv",
} as const satisfies Record<keyof ProfileSettings, keyof ProfileRow>;

const SETTINGS_FIELDS = Object.keys(FIELD_COLUMNS) as (keyof ProfileSettings)[];

function sameValue(a: unknown, b: unknown): boolean {
  return typeof a === "object" && a !== null ? JSON.stringify(a) === JSON.stringify(b) : a === b;
}

/**
 * Locks the owner for a profile write: the user-row lock serializes writes to
 * this profile, including concurrent first writes that have no profile row to
 * lock yet. NO KEY UPDATE still lets unrelated FK checks through. H54
 * removal-pending accounts are refused explicitly; non-attendees get 403.
 */
async function lockProfileOwner(db: Queryable, userId: number): Promise<void> {
  const { rows: users } = await db.query<{ account_state: string }>(
    `SELECT account_state FROM users WHERE id = $1 AND anonymized_at IS NULL FOR NO KEY UPDATE`,
    [userId],
  );
  if (users[0]?.account_state === "removal_pending") {
    throw new ConflictError("This account is being removed");
  }
  if (!users[0] || !(await hasEventAccess(db, userId))) {
    throw new ForbiddenError("Only event attendees can publish a directory profile");
  }
}

/** `changed` is false when the request repeats the stored state (#934). */
export async function updateMyPublicProfile(userId: number, input: PublicProfileInput) {
  return withTransaction(async (db) => {
    await lockProfileOwner(db, userId);
    const before = await readProfile(db, userId);
    // Omitted #935 fields keep their stored values.
    const next = Object.fromEntries(
      SETTINGS_FIELDS.map((field) => [
        field,
        input[field] === undefined ? before[FIELD_COLUMNS[field]] : input[field],
      ]),
    ) as ProfileSettings;
    if (SETTINGS_FIELDS.every((field) => sameValue(before[FIELD_COLUMNS[field]], next[field]))) {
      return { changed: false, profile: await presentProfile(db, userId, before) };
    }
    if (next.shareCv && !before.cv_key) {
      throw new BadRequestError("Upload a CV before sharing it");
    }
    const { rows } = await db.query<ProfileRow>(
      `INSERT INTO user_public_profiles
         (user_id, directory_visible, show_surname, show_photo, show_project, headline,
          location_note, bio, socials, share_cv, consented_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, CASE WHEN $2 THEN now() END)
       ON CONFLICT (user_id) DO UPDATE SET
         directory_visible = EXCLUDED.directory_visible,
         show_surname = EXCLUDED.show_surname,
         show_photo = EXCLUDED.show_photo,
         show_project = EXCLUDED.show_project,
         headline = EXCLUDED.headline,
         location_note = EXCLUDED.location_note,
         bio = EXCLUDED.bio,
         socials = EXCLUDED.socials,
         share_cv = EXCLUDED.share_cv,
         consented_at = CASE
           WHEN EXCLUDED.directory_visible AND NOT user_public_profiles.directory_visible THEN now()
           ELSE user_public_profiles.consented_at
         END
       RETURNING ${PROFILE_COLUMNS}`,
      [
        userId,
        next.directoryVisible,
        next.showSurname,
        next.showPhoto,
        next.showProject,
        next.headline,
        next.locationNote,
        next.bio,
        JSON.stringify(next.socials),
        next.shareCv,
      ],
    );
    const after = rows[0] as ProfileRow;
    const changedFields = SETTINGS_FIELDS.filter(
      (field) => !sameValue(before[FIELD_COLUMNS[field]], after[FIELD_COLUMNS[field]]),
    );
    // Free text and links stay out of the audit log; only which fields changed.
    await audit(db, {
      actorId: userId,
      entityType: "user_public_profile",
      entityId: userId,
      action: "public_profile.updated",
      before: { directoryVisible: before.directory_visible },
      after: { directoryVisible: after.directory_visible, changedFields },
      source: "participant",
    });
    return { changed: true, profile: await presentProfile(db, userId, after) };
  });
}

/**
 * Stores the owner's CV (#935). `store` writes the object while the owner
 * row is locked, so H54 removal cannot run between the check and the write.
 * Returns the replaced object's key for deletion after commit.
 */
export async function setMyCv(
  userId: number,
  cv: { key: string; filename: string },
  store: () => Promise<void>,
) {
  return withTransaction(async (db) => {
    await lockProfileOwner(db, userId);
    const before = await readProfile(db, userId);
    await store();
    const { rows } = await db.query<ProfileRow>(
      `INSERT INTO user_public_profiles (user_id, cv_key, cv_filename, cv_uploaded_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (user_id) DO UPDATE SET
         cv_key = EXCLUDED.cv_key,
         cv_filename = EXCLUDED.cv_filename,
         cv_uploaded_at = EXCLUDED.cv_uploaded_at
       RETURNING ${PROFILE_COLUMNS}`,
      [userId, cv.key, cv.filename],
    );
    await audit(db, {
      actorId: userId,
      entityType: "user_public_profile",
      entityId: userId,
      action: "public_profile.updated",
      before: { directoryVisible: before.directory_visible },
      after: { directoryVisible: before.directory_visible, changedFields: ["cv"] },
      source: "participant",
    });
    return {
      replacedKey: before.cv_key && before.cv_key !== cv.key ? before.cv_key : null,
      profile: await presentProfile(db, userId, rows[0] as ProfileRow),
    };
  });
}

/** Removes the owner's CV and stops sharing it (#935). */
export async function removeMyCv(userId: number) {
  return withTransaction(async (db) => {
    await lockProfileOwner(db, userId);
    const before = await readProfile(db, userId, true);
    if (!before.cv_key) {
      return {
        changed: false,
        removedKey: null,
        profile: await presentProfile(db, userId, before),
      };
    }
    const { rows } = await db.query<ProfileRow>(
      `UPDATE user_public_profiles
          SET cv_key = NULL, cv_filename = NULL, cv_uploaded_at = NULL, share_cv = false
        WHERE user_id = $1
        RETURNING ${PROFILE_COLUMNS}`,
      [userId],
    );
    await audit(db, {
      actorId: userId,
      entityType: "user_public_profile",
      entityId: userId,
      action: "public_profile.updated",
      before: { directoryVisible: before.directory_visible },
      after: {
        directoryVisible: before.directory_visible,
        changedFields: before.share_cv ? ["cv", "shareCv"] : ["cv"],
      },
      source: "participant",
    });
    return {
      changed: true,
      removedKey: before.cv_key,
      profile: await presentProfile(db, userId, rows[0] as ProfileRow),
    };
  });
}

/** The owner's own CV, whether or not it is shared (#935). */
export async function getMyCv(userId: number): Promise<{ key: string; filename: string }> {
  const profile = await readProfile(pool, userId);
  if (!profile.cv_key || !profile.cv_filename) throw new NotFoundError("No CV uploaded");
  return { key: profile.cv_key, filename: profile.cv_filename };
}

/** Staff moderation: hide the profile and clear its free text and links (#934, #935). */
export async function moderatePublicProfile(actorId: number, userId: number, reason: string) {
  await withTransaction(async (db) => {
    // The H54 trigger would refuse the write with a 500; answer explicitly.
    const { rows: users } = await db.query<{ account_state: string }>(
      `SELECT account_state FROM users WHERE id = $1 FOR NO KEY UPDATE`,
      [userId],
    );
    if (users[0]?.account_state === "removal_pending") {
      throw new ConflictError("This account is being removed");
    }
    const { rows } = await db.query<ProfileRow>(
      `SELECT ${PROFILE_COLUMNS} FROM user_public_profiles WHERE user_id = $1 FOR UPDATE`,
      [userId],
    );
    if (!rows[0]) throw new NotFoundError("Public profile not found");
    await db.query(
      `UPDATE user_public_profiles
          SET directory_visible = false, headline = NULL, location_note = NULL, bio = NULL,
              socials = '[]'::jsonb, share_cv = false
        WHERE user_id = $1`,
      [userId],
    );
    await audit(db, {
      actorId,
      entityType: "user_public_profile",
      entityId: userId,
      action: "public_profile.moderated",
      before: {
        directoryVisible: rows[0].directory_visible,
        hadHeadline: rows[0].headline !== null,
        hadLocationNote: rows[0].location_note !== null,
        hadBio: rows[0].bio !== null,
        socialCount: rows[0].socials.length,
        sharedCv: rows[0].share_cv,
      },
      after: { directoryVisible: false },
      reason,
      source: "admin",
    });
  });
}
