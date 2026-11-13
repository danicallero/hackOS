import type { Queryable } from "../../db/pool.js";
import { pool, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import {
  AppError,
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../../lib/errors.js";
import { photoUrl, safePdfFilename } from "../../lib/profile-files.js";
import { hasEventAccess } from "../identity/role.js";
import { ENTERPRISE_HAS_SYNTHETIC } from "../sponsors/service.js";
import { readPublishedMentor } from "./mentor.js";
import type { PublicProfileInput, SocialLink } from "./schemas.js";

/**
 * Opt-in public profiles (#934, #935), shown to the attendees who scan the
 * person's badge; there is no browsable listing. Every field a reader can see is listed in
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
  /** The person's shown repositories, each by id (#935). */
  projects: DirectoryProject[];
  /** Deprecated: the first of `projects`, kept for app builds that predate it. */
  project: DirectoryProject | null;
  challenges: { id: number; name: string }[];
  /**
   * Expertise of a published mentor profile whose owner still holds the
   * capability; independent of the networking opt-in (onboarding contract §5).
   */
  mentor: { expertise: string[] } | null;
  /** H61: knowledge of a published helper profile; `[]` otherwise. */
  helpTopics: { id: number; name: string }[];
  /** H48: shown schedule items the person speaks at, by start time. */
  activities: DirectoryActivity[];
  /** The visible company the person represents, if any. */
  enterprise: { id: number; name: string; logoUrl: string | null } | null;
}

export interface DirectoryActivity {
  id: number;
  title: string;
  startsAt: string;
  endsAt: string;
  location: string | null;
}

export interface DirectoryProject {
  kind: "project";
  id: number;
  name: string;
}

interface EntryRow {
  user_id: number;
  display_name: string;
  photo_key: string | null;
  headline: string | null;
  bio: string | null;
  location_note: string | null;
  socials: SocialLink[];
  has_cv: boolean;
  projects: DirectoryProject[];
  challenges: DirectoryEntry["challenges"];
  help_topics: DirectoryEntry["helpTopics"];
  activities: DirectoryActivity[];
  enterprise: DirectoryEntry["enterprise"];
}

/**
 * Fragments over `p` (user_public_profiles) and `u` (users). The projects are
 * every active repository submission the person belongs to (#935: a person
 * can work on several); challenges are
 * the published ones any of them still takes part in (cancelled/disqualified
 * queue entries excluded, as in projects/lifecycle.ts). Both are suppressed
 * when show_project is off.
 */
const SHOWN_REPOS_SQL = `
  SELECT r.id, r.name
    FROM submissions s
    JOIN repos r ON r.id = s.repo_id
   WHERE p.show_project
     AND s.user_id = u.id
     AND s.status = 'active'
     AND r.is_test_account = false`;

const CHALLENGE_OF_PROJECTS = `c.visibility='visible' AND c.is_test_account=false
 AND (
   EXISTS(SELECT 1 FROM project_challenges pc WHERE pc.challenge_id=c.id
     AND pc.repo_id IN(SELECT id FROM (${SHOWN_REPOS_SQL}) sr))
   OR EXISTS(SELECT 1 FROM queue_entries qe WHERE qe.challenge_id=c.id AND qe.status NOT IN('cancelled','disqualified')
     AND qe.repo_id IN(SELECT id FROM (${SHOWN_REPOS_SQL}) sr))
 )`;

/**
 * Labels or keys that name a CV in the three event languages (#935): "cv",
 * "curriculum", "currículum", "currículo", "resume", "résumé". Whole words
 * only (an underscore or digit may border them, as in `cv_file`), so "resumen"
 * does not match.
 */
const CV_NAME_PATTERN =
  "(^|[^[:alpha:]])(cv|curriculum|curr[ií]culum|curr[ií]culo|resume|r[eé]sum[eé])([^[:alpha:]]|$)";

/**
 * The person's application CV (#935, H11): a PDF uploaded to a file field of
 * their most recent submitted response, automatically, without any setup by
 * the organizer. The field the organizer marked `profile_cv` wins; otherwise
 * the first file field whose key or label names a CV. Other file fields (ID
 * documents, certificates) are never picked. It replaces any CV the person
 * uploaded on their profile and cannot be changed there; sharing it stays the
 * person's own choice. The key must sit under that response's own upload prefix.
 */
function formCvSql(userId: string): string {
  return `
  SELECT r.responses ->> f.key AS key, r.submitted_at
    FROM application_responses r
    JOIN applications a ON a.id = r.application_id
    CROSS JOIN LATERAL ROWS FROM (
      jsonb_to_recordset(
        CASE WHEN jsonb_typeof(a.template) = 'array' THEN a.template ELSE '[]'::jsonb END
      ) AS (key text, kind text, profile_cv boolean, label jsonb)
    ) WITH ORDINALITY AS f
   WHERE r.user_id = ${userId}
     AND r.status <> 'draft'
     AND r.submitted_at IS NOT NULL
     AND f.kind = 'file'
     AND (
       COALESCE(f.profile_cv, false)
       OR f.key ~* '${CV_NAME_PATTERN}'
       OR COALESCE(f.label::text, '') ~* '${CV_NAME_PATTERN}'
     )
     AND r.responses ->> f.key LIKE 'uploads/' || r.application_id || '/' || r.user_id || '/%'
     AND lower(r.responses ->> f.key) LIKE '%.pdf'
   ORDER BY COALESCE(f.profile_cv, false) DESC, r.submitted_at DESC, r.id DESC, f.ordinality
   LIMIT 1`;
}

interface FormCv {
  key: string;
  filename: string;
  submittedAt: Date;
}

async function readFormCv(db: Queryable, userId: number): Promise<FormCv | null> {
  const { rows } = await db.query<{ key: string; submitted_at: Date }>(formCvSql("$1"), [userId]);
  if (!rows[0]) return null;
  return {
    key: rows[0].key,
    filename: safePdfFilename(rows[0].key.split("/").pop()),
    submittedAt: rows[0].submitted_at,
  };
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
 * Every field a reader can see. The GitHub link is the member's linked GitHub account,
 * never typed text. `profiles` is the FROM item that binds `p`:
 * the stored table or the owner's unsaved preview.
 */
function entrySql(profiles: string, accountLinks = true): string {
  return `
  SELECT u.id AS user_id,
         e.display_name,
         CASE WHEN p.show_photo THEN u.photo_key END AS photo_key,
         p.headline,
         p.bio,
         p.location_note,
         COALESCE((SELECT jsonb_agg(s) FROM jsonb_array_elements(p.socials) s
                    WHERE s->>'kind' <> 'github'), '[]'::jsonb)
         || COALESCE((SELECT jsonb_build_array(
                        jsonb_build_object('kind', 'github', 'url', 'https://github.com/' || ga.login))
                        FROM github_accounts ga
                       WHERE ga.user_id = u.id AND p.show_github AND ${accountLinks}), '[]'::jsonb) AS socials,
         (p.share_cv AND COALESCE(fcv.key, p.cv_key) IS NOT NULL) AS has_cv,
         COALESCE((
           SELECT jsonb_agg(jsonb_build_object('kind', 'project', 'id', sr.id, 'name', sr.name) ORDER BY sr.id)
             FROM (${SHOWN_REPOS_SQL}) sr
         ), '[]'::jsonb) AS projects,
         COALESCE((
           SELECT jsonb_agg(jsonb_build_object('id', c.id, 'name', c.title) ORDER BY c.title, c.id)
             FROM challenges c
            WHERE ${CHALLENGE_OF_PROJECTS}
         ), '[]'::jsonb) AS challenges,
         COALESCE((
           SELECT jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) ORDER BY lower(t.name), t.id)
             FROM helper_profiles hp
             JOIN helper_topics ht ON ht.user_id = hp.user_id
             JOIN help_topics t ON t.id = ht.topic_id
            WHERE hp.user_id = u.id AND hp.published
         ), '[]'::jsonb) AS help_topics,
         COALESCE((
           SELECT jsonb_agg(jsonb_build_object('id', s.id, 'title', s.title, 'startsAt', s.starts_at,
                                               'endsAt', s.ends_at, 'location', s.location)
                            ORDER BY s.starts_at, s.id)
             FROM schedule_speakers ss
             JOIN schedule s ON s.id = ss.schedule_id
            WHERE ss.user_id = u.id
              AND s.visibility = 'shown'
              AND (s.publish_at IS NULL OR s.publish_at <= now())
              AND 'participant' = ANY (s.audiences)
         ), '[]'::jsonb) AS activities,
         (SELECT jsonb_build_object('id', e.id, 'name', e.name, 'logoUrl', e.logo_url)
            FROM sponsors sp
            JOIN enterprises e ON e.id = sp.enterprise_id
           WHERE sp.user_id = u.id AND e.visibility = 'visible' AND NOT ${ENTERPRISE_HAS_SYNTHETIC}
           ORDER BY sp.id
           LIMIT 1) AS enterprise
    FROM ${profiles}
    JOIN users u ON u.id = p.user_id
    ${DISPLAY_NAME_JOIN}
    LEFT JOIN LATERAL (${formCvSql("u.id")}) fcv ON true`;
}

/** Shared profiles: opted in, admitted to the event, never a test account. */
const VISIBLE_WHERE = `
  p.directory_visible
  AND u.is_test_account = false
  AND EXISTS (SELECT 1 FROM user_event_access a WHERE a.user_id = u.id)`;

/** `cvPath` differs for the owner's preview, which reads their own CV route. */
function toEntry(row: EntryRow, cvPath = `/api/directory/${row.user_id}/cv`): DirectoryEntry {
  const userId = Number(row.user_id);
  const projects = row.projects.map(({ kind, id, name }) => ({ kind, id: Number(id), name }));
  return {
    userId,
    displayName: row.display_name,
    photoUrl: photoUrl(userId, row.photo_key),
    headline: row.headline,
    bio: row.bio,
    locationNote: row.location_note,
    socials: row.socials.map(({ kind, url }) => ({ kind, url })),
    cvUrl: row.has_cv ? cvPath : null,
    projects,
    project: projects[0] ?? null,
    challenges: row.challenges.map((c) => ({ id: Number(c.id), name: c.name })),
    mentor: null,
    helpTopics: (row.help_topics ?? []).map((t) => ({ id: Number(t.id), name: t.name })),
    activities: (row.activities ?? []).map((a) => ({
      id: Number(a.id),
      title: a.title,
      startsAt: new Date(a.startsAt).toISOString(),
      endsAt: new Date(a.endsAt).toISOString(),
      location: a.location ?? null,
    })),
    enterprise: row.enterprise
      ? {
          id: Number(row.enterprise.id),
          name: row.enterprise.name,
          logoUrl: row.enterprise.logoUrl ?? null,
        }
      : null,
  };
}

/**
 * A person who published a mentor profile but keeps the networking opt-in
 * off: only the name as they would show it by default (surname initial) and
 * the expertise; no photo, bio, links, CV or projects.
 */
const MENTOR_ONLY_PROFILE = `(SELECT user_id, false AS directory_visible, false AS show_surname,
    false AS show_photo, false AS show_project, false AS show_github, NULL::text AS headline, NULL::text AS bio,
    NULL::text AS location_note, '[]'::jsonb AS socials, false AS share_cv, NULL::text AS cv_key
    FROM mentor_profiles WHERE published) p`;

/**
 * Whether `userId`'s photo is published to profile readers: the same
 * shared-profile set as the cards, with the photo switch on (#934).
 */
export async function photoPublishedInDirectory(db: Queryable, userId: number): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM user_public_profiles p JOIN users u ON u.id = p.user_id
      WHERE ${VISIBLE_WHERE} AND p.show_photo AND u.id = $1`,
    [userId],
  );
  return rows.length > 0;
}

/**
 * Whether the person's shared profile (opt-in on, admitted, not a test
 * account) is also on a public surface any attendee can open: a speaker of a
 * shown, published, participant-audience schedule item, or a representative of
 * a visible, non-synthetic company (H44, H48). The photo and the profile card
 * both follow this rule; `requirePhoto` adds the photo switch.
 */
async function sharedOnPublicSurface(
  db: Queryable,
  userId: number,
  requirePhoto: boolean,
): Promise<boolean> {
  const { rowCount } = await db.query(
    `SELECT 1 FROM user_public_profiles p JOIN users u ON u.id = p.user_id
      WHERE ${VISIBLE_WHERE} ${requirePhoto ? "AND p.show_photo" : ""} AND u.id = $1
        AND (EXISTS (
         SELECT 1 FROM schedule_speakers ss JOIN schedule s ON s.id = ss.schedule_id
          WHERE ss.user_id = u.id AND s.visibility = 'shown'
            AND (s.publish_at IS NULL OR s.publish_at <= now())
            AND 'participant' = ANY (s.audiences))
       OR EXISTS (
         SELECT 1 FROM sponsors sp JOIN enterprises e ON e.id = sp.enterprise_id
          WHERE sp.user_id = u.id AND e.visibility = 'visible' AND NOT ${ENTERPRISE_HAS_SYNTHETIC}))`,
    [userId],
  );
  return (rowCount ?? 0) > 0;
}

/** The shared photo of a speaker or company representative, readable by any attendee. */
export function photoPublishedOnPublicSurface(db: Queryable, userId: number): Promise<boolean> {
  return sharedOnPublicSurface(db, userId, true);
}

/** The shared profile of a speaker or company representative, readable by any attendee. */
export function profilePublishedOnPublicSurface(db: Queryable, userId: number): Promise<boolean> {
  return sharedOnPublicSurface(db, userId, false);
}

async function assertReaderAdmitted(userId: number): Promise<void> {
  if (!(await hasEventAccess(pool, userId))) {
    throw new ForbiddenError("Public profiles are only available to event attendees");
  }
}

/**
 * Whether the reader saved this person in their event diary (#935). There is
 * no browsable directory: a person's public profile is readable only by the
 * attendees who scanned them; visibility is still enforced by the caller's
 * query.
 */
export async function savedByReader(
  db: Queryable,
  readerId: number,
  userId: number,
): Promise<boolean> {
  const { rowCount } = await db.query(
    "SELECT 1 FROM diary_entries WHERE owner_id = $1 AND target_user_id = $2",
    [readerId, userId],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Readers see the people they saved and the opted-in speakers and company
 * representatives anyone can already see on the schedule and company pages
 * (H44, H48); hidden, missing and other people are deliberately
 * indistinguishable (#934, #935).
 */
async function assertMayReadPerson(readerId: number, userId: number): Promise<boolean> {
  await assertReaderAdmitted(readerId);
  const saved = await savedByReader(pool, readerId, userId);
  if (!saved && !(await profilePublishedOnPublicSurface(pool, userId))) {
    throw new NotFoundError("Person not found");
  }
  return saved;
}

export async function getDirectoryEntry(readerId: number, userId: number): Promise<DirectoryEntry> {
  const saved = await assertMayReadPerson(readerId, userId);
  const { rows } = await pool.query<EntryRow>(
    `${entrySql("user_public_profiles p")} WHERE ${VISIBLE_WHERE} AND u.id = $1`,
    [userId],
  );
  const mentor = await readPublishedMentor(pool, userId);
  if (!rows[0]) {
    if (!mentor) throw new NotFoundError("Person not found");
    const { rows: only } = await pool.query<EntryRow>(
      `${entrySql(MENTOR_ONLY_PROFILE, false)}
        WHERE u.is_test_account = false AND u.id = $1
          AND EXISTS (SELECT 1 FROM user_event_access a WHERE a.user_id = u.id)`,
      [userId],
    );
    if (!only[0]) throw new NotFoundError("Person not found");
    return { ...toEntry(only[0]), mentor };
  }
  // The CV needs a scan: someone opened only as a speaker or representative
  // exposes no CV (the CV route stays scan-only too).
  const entry = toEntry(rows[0]);
  return { ...entry, cvUrl: saved ? entry.cvUrl : null, mentor };
}

/**
 * The CV a person shares (#935): their application CV when there is one,
 * otherwise their upload. `scope` is the visibility predicate over `p`/`u`;
 * a hidden profile, an unshared CV and a missing CV all answer the same 404.
 */
async function readSharedCv(
  userId: number,
  scope: string,
): Promise<{ key: string; filename: string }> {
  const { rows } = await pool.query<{ cv_key: string | null; cv_filename: string | null }>(
    `SELECT p.cv_key, p.cv_filename
       FROM user_public_profiles p JOIN users u ON u.id = p.user_id
      WHERE ${scope} AND p.share_cv AND u.id = $1`,
    [userId],
  );
  if (!rows[0]) throw new NotFoundError("Person not found");
  const cv = await readFormCv(pool, userId);
  if (cv) return { key: cv.key, filename: cv.filename };
  if (!rows[0].cv_key || !rows[0].cv_filename) throw new NotFoundError("Person not found");
  return { key: rows[0].cv_key, filename: rows[0].cv_filename };
}

/** The shared CV of an opted-in person the reader saved (#935); a scan is required. */
export async function getDirectoryCv(
  readerId: number,
  userId: number,
): Promise<{ key: string; filename: string }> {
  await assertReaderAdmitted(readerId);
  if (!(await savedByReader(pool, readerId, userId))) throw new NotFoundError("Person not found");
  return readSharedCv(userId, VISIBLE_WHERE);
}

/**
 * H61, H63: a published helper's CV for help desk readers, while the person's
 * own `share_cv` switch is on. Publishing the helper profile is the consent;
 * badge-scan sharing (`directory_visible`) is not required. The caller has
 * already checked the helper is listed and the reader may browse helpers.
 */
export async function getHelperCv(userId: number): Promise<{ key: string; filename: string }> {
  return readSharedCv(userId, "u.is_test_account = false");
}

/** H64, H66: a requester's shared CV; needs a shared (visible) profile. The caller checked access. */
export async function getRequesterCv(userId: number): Promise<{ key: string; filename: string }> {
  return readSharedCv(userId, VISIBLE_WHERE);
}

/**
 * H61, H63: a published helper's public profile exactly as people see it after
 * scanning their badge, honouring the per-field switches but independent of
 * `directory_visible` and diary saves. Creates nothing. The caller has
 * already checked the helper is listed.
 */
export async function helperProfileEntry(
  db: Queryable,
  userId: number,
  cvPath = `/api/directory/${userId}/cv`,
): Promise<DirectoryEntry> {
  return preview(db, userId, await readProfile(db, userId), cvPath);
}

/**
 * Live cards of the given people that are visible right now, keyed by user id
 * (#935 event diary). Anyone hidden, missing or no longer admitted is simply
 * absent; no reader gate is applied here.
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
  show_github: boolean;
  headline: string | null;
  bio: string | null;
  location_note: string | null;
  socials: SocialLink[];
  share_cv: boolean;
  cv_key: string | null;
  cv_filename: string | null;
  cv_uploaded_at: Date | null;
  consented_at: Date | null;
  onboarding_completed_at: Date | null;
}

const DEFAULT_PROFILE: ProfileRow = {
  directory_visible: false,
  show_surname: false,
  show_photo: false,
  show_project: true,
  show_github: true,
  headline: null,
  bio: null,
  location_note: null,
  socials: [],
  share_cv: false,
  cv_key: null,
  cv_filename: null,
  cv_uploaded_at: null,
  consented_at: null,
  onboarding_completed_at: null,
};

export const OWN_CV_PATH = "/api/me/public-profile/cv";

/** The staff CV route of user management (#935 moderation). */
export function staffCvPath(userId: number): string {
  return `/api/users/${userId}/public-profile/cv`;
}

/**
 * Preview: the card exactly as readers would see it if visible. `cvPath` is
 * the route the previewer itself may download the CV from (owner or staff).
 */
async function preview(db: Queryable, userId: number, profile: ProfileRow, cvPath: string) {
  const { rows } = await db.query<EntryRow>(
    `WITH p AS (
       SELECT $1::int AS user_id, $2::boolean AS show_surname, $3::boolean AS show_photo,
              $4::boolean AS show_project, $5::boolean AS show_github, $6::text AS headline,
              $7::text AS location_note, $8::text AS bio, $9::jsonb AS socials,
              $10::boolean AS share_cv, $11::text AS cv_key
     )
     ${entrySql("p")} WHERE u.id = $1`,
    [
      userId,
      profile.show_surname,
      profile.show_photo,
      profile.show_project,
      profile.show_github,
      profile.headline,
      profile.location_note,
      profile.bio,
      JSON.stringify(profile.socials),
      profile.share_cv,
      profile.cv_key,
    ],
  );
  if (!rows[0]) throw new NotFoundError("User not found");
  return toEntry(rows[0], cvPath);
}

async function presentProfile(
  db: Queryable,
  userId: number,
  profile: ProfileRow,
  cvPath = OWN_CV_PATH,
) {
  const formCv = await readFormCv(db, userId);
  return {
    directoryVisible: profile.directory_visible,
    showSurname: profile.show_surname,
    showPhoto: profile.show_photo,
    showProject: profile.show_project,
    showGithub: profile.show_github,
    headline: profile.headline,
    bio: profile.bio,
    locationNote: profile.location_note,
    socials: profile.socials
      .filter(({ kind }) => kind !== "github")
      .map(({ kind, url }) => ({ kind, url })),
    shareCv: profile.share_cv,
    cv: formCv
      ? {
          filename: formCv.filename,
          uploadedAt: formCv.submittedAt.toISOString(),
          source: "application" as const,
        }
      : profile.cv_filename && profile.cv_uploaded_at
        ? {
            filename: profile.cv_filename,
            uploadedAt: profile.cv_uploaded_at.toISOString(),
            source: "upload" as const,
          }
        : null,
    onboardingCompletedAt: profile.onboarding_completed_at?.toISOString() ?? null,
    consentedAt: profile.consented_at ? profile.consented_at.toISOString() : null,
    preview: await preview(db, userId, profile, cvPath),
  };
}

const PROFILE_COLUMNS = `directory_visible, show_surname, show_photo, show_project, show_github, headline, bio,
  location_note, socials, share_cv, cv_key, cv_filename, cv_uploaded_at, consented_at, onboarding_completed_at`;

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

/**
 * Who writes a public profile: the owner, or user-management staff
 * moderating it (#935). Staff writes are audited with source `admin`, skip
 * the event-access gate (a profile can outlive the person's access) and can
 * never turn sharing on: opting in stays the person's own consent.
 */
export interface ProfileActor {
  actorId: number;
  source: "participant" | "admin";
}

function ownActor(userId: number): ProfileActor {
  return { actorId: userId, source: "participant" };
}

function cvPathFor(userId: number, actor: ProfileActor): string {
  return actor.source === "admin" ? staffCvPath(userId) : OWN_CV_PATH;
}

/** Staff view of any user's profile, opted in or not (#935 moderation). */
export async function getStaffPublicProfile(userId: number) {
  const { rows } = await pool.query(`SELECT 1 FROM users WHERE id = $1`, [userId]);
  if (!rows[0]) throw new NotFoundError("User not found");
  return presentProfile(pool, userId, await readProfile(pool, userId), staffCvPath(userId));
}

type ProfileSettings = Required<PublicProfileInput>;

const FIELD_COLUMNS = {
  directoryVisible: "directory_visible",
  showSurname: "show_surname",
  showPhoto: "show_photo",
  showProject: "show_project",
  showGithub: "show_github",
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

/**
 * Staff lock (#935 moderation): the same user-row lock as the owner's, without
 * the event-access gate; unknown and anonymized accounts are 404 and accounts
 * being removed (H54) 409.
 */
async function lockProfileSubject(db: Queryable, userId: number): Promise<void> {
  const { rows } = await db.query<{ account_state: string }>(
    `SELECT account_state FROM users WHERE id = $1 AND anonymized_at IS NULL FOR NO KEY UPDATE`,
    [userId],
  );
  if (!rows[0]) throw new NotFoundError("User not found");
  if (rows[0].account_state === "removal_pending") {
    throw new ConflictError("This account is being removed");
  }
}

async function lockFor(db: Queryable, userId: number, actor: ProfileActor): Promise<void> {
  if (actor.source === "admin") await lockProfileSubject(db, userId);
  else await lockProfileOwner(db, userId);
}

/** `changed` is false when the request repeats the stored state (#934). */
export async function updateMyPublicProfile(
  userId: number,
  input: PublicProfileInput & { completeOnboarding?: boolean },
) {
  return updatePublicProfile(userId, input, ownActor(userId), input.completeOnboarding === true);
}

export async function updatePublicProfile(
  userId: number,
  input: PublicProfileInput,
  actor: ProfileActor,
  completeOnboarding = false,
) {
  return withTransaction(async (db) => {
    await lockFor(db, userId, actor);
    const before = await readProfile(db, userId);
    // Omitted #935 fields keep their stored values.
    const next = Object.fromEntries(
      SETTINGS_FIELDS.map((field) => [
        field,
        input[field] === undefined ? before[FIELD_COLUMNS[field]] : input[field],
      ]),
    ) as ProfileSettings;
    const finishOnboarding = completeOnboarding && !before.onboarding_completed_at;
    if (
      !finishOnboarding &&
      SETTINGS_FIELDS.every((field) => sameValue(before[FIELD_COLUMNS[field]], next[field]))
    ) {
      return {
        changed: false,
        profile: await presentProfile(db, userId, before, cvPathFor(userId, actor)),
      };
    }
    if (actor.source === "admin" && next.directoryVisible && !before.directory_visible) {
      throw new AppError(
        409,
        "profile_consent_required",
        "Only the person can start sharing their profile",
      );
    }
    if (next.shareCv && !before.cv_key && !(await readFormCv(db, userId))) {
      throw new BadRequestError("Upload a CV before sharing it");
    }
    const { rows } = await db.query<ProfileRow>(
      `INSERT INTO user_public_profiles
         (user_id, directory_visible, show_surname, show_photo, show_project, show_github, headline,
          location_note, bio, socials, share_cv, consented_at, onboarding_completed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, CASE WHEN $2 THEN now() END, CASE WHEN $12 THEN now() END)
       ON CONFLICT (user_id) DO UPDATE SET
         directory_visible = EXCLUDED.directory_visible,
         show_surname = EXCLUDED.show_surname,
         show_photo = EXCLUDED.show_photo,
         show_project = EXCLUDED.show_project,
         show_github = EXCLUDED.show_github,
         headline = EXCLUDED.headline,
         location_note = EXCLUDED.location_note,
         bio = EXCLUDED.bio,
         socials = EXCLUDED.socials,
         share_cv = EXCLUDED.share_cv,
         onboarding_completed_at = COALESCE(user_public_profiles.onboarding_completed_at, EXCLUDED.onboarding_completed_at),
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
        next.showGithub,
        next.headline,
        next.locationNote,
        next.bio,
        JSON.stringify(next.socials),
        next.shareCv,
        completeOnboarding,
      ],
    );
    const after = rows[0] as ProfileRow;
    const changedFields = SETTINGS_FIELDS.filter(
      (field) => !sameValue(before[FIELD_COLUMNS[field]], after[FIELD_COLUMNS[field]]),
    );
    // Free text and links stay out of the audit log; only which fields changed.
    await audit(db, {
      actorId: actor.actorId,
      entityType: "user_public_profile",
      entityId: userId,
      action: "public_profile.updated",
      before: { directoryVisible: before.directory_visible },
      after: {
        directoryVisible: after.directory_visible,
        changedFields,
        ...(finishOnboarding ? { onboardingCompleted: true } : {}),
      },
      source: actor.source,
    });
    return {
      changed: true,
      profile: await presentProfile(db, userId, after, cvPathFor(userId, actor)),
    };
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
    await assertNoFormCv(db, userId);
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

/** While the application provides the CV, the profile cannot replace or remove it (#935). */
async function assertNoFormCv(db: Queryable, userId: number): Promise<void> {
  if (await readFormCv(db, userId)) {
    throw new ConflictError("Your CV comes from your application and cannot be changed here");
  }
}

/** Removes the owner's CV and stops sharing it (#935). */
export async function removeMyCv(userId: number) {
  return removeCv(userId, ownActor(userId));
}

/** Removes an uploaded CV and stops sharing it; staff use it to moderate (#935). */
export async function removeCv(userId: number, actor: ProfileActor) {
  return withTransaction(async (db) => {
    await lockFor(db, userId, actor);
    await assertNoFormCv(db, userId);
    const before = await readProfile(db, userId, true);
    if (!before.cv_key) {
      return {
        changed: false,
        removedKey: null,
        profile: await presentProfile(db, userId, before, cvPathFor(userId, actor)),
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
      actorId: actor.actorId,
      entityType: "user_public_profile",
      entityId: userId,
      action: "public_profile.updated",
      before: { directoryVisible: before.directory_visible },
      after: {
        directoryVisible: before.directory_visible,
        changedFields: before.share_cv ? ["cv", "shareCv"] : ["cv"],
      },
      source: actor.source,
    });
    return {
      changed: true,
      removedKey: before.cv_key,
      profile: await presentProfile(db, userId, rows[0] as ProfileRow, cvPathFor(userId, actor)),
    };
  });
}

/**
 * The person's own CV (the application's when there is one), shared or not:
 * for the owner, and for user-management staff moderating it (#935).
 */
export async function getMyCv(userId: number): Promise<{ key: string; filename: string }> {
  const formCv = await readFormCv(pool, userId);
  if (formCv) return { key: formCv.key, filename: formCv.filename };
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
