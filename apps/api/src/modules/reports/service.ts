import { CAPABILITIES } from "@hackos/shared/capabilities";
import { pool, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { createAuthorizationContext, userHasCapability } from "../../lib/capabilities.js";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  TooManyRequestsError,
} from "../../lib/errors.js";
import { savedByReader } from "../directory/service.js";
import { hasEventAccess } from "../identity/role.js";
import { canViewProject, projectViewer } from "../projects/policy.js";

export type ReportKind = "project" | "profile";
export type ReportStatus = "open" | "actioned" | "dismissed";
export type ReportReason = "inappropriate" | "harassment" | "spam" | "other";

/** A reporter may keep this many reports open at once. */
const MAX_OPEN_REPORTS = 10;

/** Which kinds of report a moderator may read and resolve, by capability. */
export async function moderatedKinds(userId: number): Promise<ReportKind[]> {
  const context = createAuthorizationContext(userId, pool);
  const kinds: ReportKind[] = [];
  if (await userHasCapability(context, CAPABILITIES.PROJECTS_EDIT)) kinds.push("project");
  if (await userHasCapability(context, CAPABILITIES.USERS_WRITE)) kinds.push("profile");
  return kinds;
}

interface NewReport {
  reason: ReportReason;
  details?: string | null;
  projectId?: number;
  userId?: number;
}

/**
 * H18: an attendee reports a project page or a public profile they can see.
 * Targets the reporter cannot see answer 404, so a report cannot probe for
 * hidden content; reporting the same target twice returns the open report.
 */
export async function createReport(reporterId: number, input: NewReport) {
  if (!(await hasEventAccess(pool, reporterId))) {
    throw new ForbiddenError("Reporting is only available to event attendees");
  }
  const projectId = input.projectId ?? null;
  const targetUserId = input.userId ?? null;
  if (projectId !== null) {
    if (!(await canViewProject(pool, reporterId, projectId))) {
      throw new NotFoundError("Project not found");
    }
    const { rowCount } = await pool.query(
      `SELECT 1 FROM submissions WHERE repo_id = $1 AND user_id = $2 AND status = 'active'`,
      [projectId, reporterId],
    );
    if (rowCount) throw new BadRequestError("You cannot report your own project");
  } else if (targetUserId !== null) {
    if (targetUserId === reporterId) throw new BadRequestError("You cannot report yourself");
    if (!(await savedByReader(pool, reporterId, targetUserId))) {
      throw new NotFoundError("Person not found");
    }
  } else {
    throw new BadRequestError("A report needs a project or a person");
  }

  return withTransaction(async (client) => {
    const { rows: existing } = await client.query<{ id: number }>(
      `SELECT id FROM content_reports
        WHERE reporter_id = $1 AND status = 'open'
          AND repo_id IS NOT DISTINCT FROM $2 AND target_user_id IS NOT DISTINCT FROM $3`,
      [reporterId, projectId, targetUserId],
    );
    if (existing[0]) return { id: existing[0].id, status: "open" as const };
    const { rows: open } = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM content_reports
        WHERE reporter_id = $1 AND status = 'open'`,
      [reporterId],
    );
    if ((open[0]?.count ?? 0) >= MAX_OPEN_REPORTS) {
      throw new TooManyRequestsError("Too many open reports");
    }
    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO content_reports (reporter_id, repo_id, target_user_id, reason, details)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [reporterId, projectId, targetUserId, input.reason, input.details?.trim() || null],
    );
    return { id: (rows[0] as { id: number }).id, status: "open" as const };
  });
}

interface ReportRow {
  id: number;
  repo_id: number | null;
  target_user_id: number | null;
  reason: ReportReason;
  details: string | null;
  status: ReportStatus;
  created_at: Date;
  resolved_at: Date | null;
  reporter_id: number;
  reporter_name: string | null;
  reporter_surname: string | null;
  project_name: string | null;
  target_name: string | null;
  target_surname: string | null;
}

/** Reports of the kinds the moderator holds the capability for, newest first. */
export async function listReports(
  moderatorId: number,
  kinds: ReportKind[],
  status: ReportStatus | "all",
) {
  if (kinds.length === 0) return [];
  const viewer = await projectViewer(pool, moderatorId);
  const { rows } = await pool.query<ReportRow>(
    `SELECT r.id, r.repo_id, r.target_user_id, r.reason, r.details, r.status,
            r.created_at, r.resolved_at,
            reporter.id AS reporter_id, reporter.name AS reporter_name,
            reporter.surname AS reporter_surname,
            repo.name AS project_name,
            target.name AS target_name, target.surname AS target_surname
       FROM content_reports r
       JOIN users reporter ON reporter.id = r.reporter_id
       LEFT JOIN repos repo ON repo.id = r.repo_id
       LEFT JOIN users target ON target.id = r.target_user_id
      WHERE reporter.is_test_account = $1
        AND ($2::text = 'all' OR r.status = $2)
        AND ((r.repo_id IS NOT NULL AND 'project' = ANY($3::text[]))
          OR (r.target_user_id IS NOT NULL AND 'profile' = ANY($3::text[])))
      ORDER BY (r.status = 'open') DESC, r.created_at DESC, r.id DESC
      LIMIT 200`,
    [viewer.fixtureMarker, status, kinds],
  );
  return rows.map((row) => ({
    id: row.id,
    kind: (row.repo_id === null ? "profile" : "project") as ReportKind,
    reason: row.reason,
    details: row.details,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    resolvedAt: row.resolved_at?.toISOString() ?? null,
    reporter: { id: row.reporter_id, name: row.reporter_name, surname: row.reporter_surname },
    project: row.repo_id === null ? null : { id: row.repo_id, name: row.project_name ?? "" },
    person:
      row.target_user_id === null
        ? null
        : { id: row.target_user_id, name: row.target_name, surname: row.target_surname },
  }));
}

/** H18/H53: a moderator closes a report as actioned or dismissed, with an audit row. */
export async function resolveReport(
  moderatorId: number,
  kinds: ReportKind[],
  reportId: number,
  status: "actioned" | "dismissed",
  note: string | null,
) {
  const viewer = await projectViewer(pool, moderatorId);
  await withTransaction(async (client) => {
    const { rows } = await client.query<{
      status: ReportStatus;
      repo_id: number | null;
      target_user_id: number | null;
      reporter_test: boolean;
    }>(
      `SELECT r.status, r.repo_id, r.target_user_id, reporter.is_test_account AS reporter_test
         FROM content_reports r JOIN users reporter ON reporter.id = r.reporter_id
        WHERE r.id = $1 FOR UPDATE OF r`,
      [reportId],
    );
    const report = rows[0];
    const kind: ReportKind | null = !report
      ? null
      : report.repo_id === null
        ? "profile"
        : "project";
    // Out-of-scope reports are indistinguishable from missing ones.
    if (
      !report ||
      kind === null ||
      !kinds.includes(kind) ||
      report.reporter_test !== viewer.fixtureMarker
    ) {
      throw new NotFoundError("Report not found");
    }
    if (report.status !== "open") throw new ConflictError("This report is already closed");
    await client.query(
      `UPDATE content_reports
          SET status = $2, resolved_by = $3, resolved_at = now()
        WHERE id = $1`,
      [reportId, status, moderatorId],
    );
    await audit(client, {
      actorId: moderatorId,
      entityType: "content_report",
      entityId: reportId,
      action: `content_report.${status}`,
      before: { status: "open" },
      after: { status },
      reason: note ?? undefined,
      source: "admin",
    });
  });
}
