import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { Queryable } from "../../db/pool.js";
import { createAuthorizationContext, userHasCapability } from "../../lib/capabilities.js";
import { ForbiddenError } from "../../lib/errors.js";
import { getEventTimezone } from "../event/service.js";
import { hasEventAccess } from "../identity/role.js";

/** SQL owns clock boundaries for every native project projection (#1008). */
export async function projectPhase(db: Queryable) {
  const { rows } = await db.query<{
    editing: boolean;
    draftsOpen: boolean;
    submitting: boolean;
    galleryOpen: boolean;
    galleryOpensAt: Date | null;
    draftVisibility: "team_only" | "attendees" | "public";
    galleryAudience: "staff" | "attendees" | "public";
  }>(`SELECT
    COALESCE(project_drafts_open_at,hacking_starts_at) IS NOT NULL
      AND now() >= COALESCE(project_drafts_open_at,hacking_starts_at)
      AND COALESCE(project_submissions_close_at,hacking_ends_at) IS NOT NULL
      AND now() <= COALESCE(project_edits_lock_at,project_submissions_close_at,hacking_ends_at) AS editing,
    COALESCE(project_drafts_open_at,hacking_starts_at) IS NOT NULL AND now()>=COALESCE(project_drafts_open_at,hacking_starts_at) AND now()<=COALESCE(project_submissions_close_at,hacking_ends_at) AS submitting,
    COALESCE(project_drafts_open_at,hacking_starts_at) IS NOT NULL AND now() >= COALESCE(project_drafts_open_at,hacking_starts_at) AS "draftsOpen",
    project_gallery_opens_at IS NOT NULL AND now() >= project_gallery_opens_at AS "galleryOpen",
    project_gallery_opens_at AS "galleryOpensAt",
    project_draft_visibility AS "draftVisibility",project_gallery_audience AS "galleryAudience"
    FROM event_config WHERE id=1`);
  return (
    rows[0] ?? {
      editing: false,
      draftsOpen: false,
      submitting: false,
      galleryOpen: false,
      galleryOpensAt: null,
      draftVisibility: "team_only" as const,
      galleryAudience: "staff" as const,
    }
  );
}

export async function projectViewer(db: Queryable, userId: number | null) {
  if (userId === null) return { userId, staff: false, attendee: false, fixtureMarker: false };
  const { rows } = await db.query(
    "SELECT id,is_test_account FROM users WHERE id=$1 AND account_state='active' AND anonymized_at IS NULL",
    [userId],
  );
  if (!rows.length) return { userId: null, staff: false, attendee: false, fixtureMarker: false };
  return {
    userId,
    fixtureMarker: rows[0].is_test_account === true,
    staff: await userHasCapability(
      createAuthorizationContext(userId, db),
      CAPABILITIES.PROJECTS_READ,
    ),
    attendee: await hasEventAccess(db, userId),
  };
}

/**
 * Gallery and published winners use the same audience decision (#1009,#1010).
 * H18: attendees and visitors browse once the gallery opens; project staff
 * (PROJECTS_READ, who already read every project) browse it at any time.
 */
export async function galleryAccess(
  db: Queryable,
  userId: number | null,
): Promise<
  { allowed: true } | { allowed: false; reason: "closed" | "audience"; opensAt: string | null }
> {
  const phase = await projectPhase(db);
  const viewer = await projectViewer(db, userId);
  if (viewer.staff) return { allowed: true };
  const audience =
    phase.galleryAudience === "public" ||
    (phase.galleryAudience === "attendees" && viewer.attendee);
  if (!audience) return { allowed: false, reason: "audience", opensAt: null };
  if (!phase.galleryOpen)
    return {
      allowed: false,
      reason: "closed",
      opensAt: phase.galleryOpensAt ? new Date(phase.galleryOpensAt).toISOString() : null,
    };
  return { allowed: true };
}

export async function canViewGallery(db: Queryable, userId: number | null): Promise<boolean> {
  return (await galleryAccess(db, userId)).allowed;
}

/** H18: a refused gallery read says whether it is not open yet (and when) or not for this audience. */
export async function assertGalleryVisible(db: Queryable, userId: number | null) {
  const access = await galleryAccess(db, userId);
  if (!access.allowed)
    throw new ForbiddenError(
      access.reason === "closed"
        ? "The project gallery is not open yet"
        : "The project gallery is not available to this audience",
      {
        reason: access.reason === "closed" ? "gallery_closed" : "gallery_audience",
        opensAt: access.opensAt,
        // Lets server-rendered clients show the opening time in event time.
        timeZone: await getEventTimezone(db),
      },
    );
}

export async function canViewProject(
  db: Queryable,
  userId: number | null,
  projectId: number,
): Promise<boolean> {
  const viewer = await projectViewer(db, userId);
  const { rows } = await db.query(
    `SELECT r.submission_status,
    EXISTS(SELECT 1 FROM submissions s WHERE s.repo_id=r.id AND s.user_id=$2
      AND s.status='active') AS member FROM repos r WHERE r.id=$1 AND r.is_test_account=$3`,
    [projectId, viewer.userId, viewer.fixtureMarker],
  );
  const project = rows[0];
  if (!project) return false;
  if (viewer.staff || project.member) return true;
  const phase = await projectPhase(db);
  if (project.submission_status === "submitted") return canViewGallery(db, userId);
  return (
    phase.draftsOpen &&
    (phase.draftVisibility === "public" ||
      (phase.draftVisibility === "attendees" && viewer.attendee))
  );
}

export async function assertProjectWindow(db: Queryable): Promise<void> {
  if (!(await projectPhase(db)).editing) throw new ForbiddenError("Project editing is closed");
}
