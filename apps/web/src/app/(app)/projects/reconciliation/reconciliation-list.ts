import type { MessageKey } from "@/lib/i18n";
import type { ProjectSubmission } from "@/lib/projects";

export type ReconciliationRow = {
  key: string;
  id: number;
  name: string;
  code: string;
  status: string;
  source: "planning" | "native" | "devpost" | "hybrid";
  issues: MessageKey[];
  project?: ProjectSubmission;
};

function issuesForProject(project: ProjectSubmission): MessageKey[] {
  const issues: MessageKey[] = [];
  if (project.requests.some((request) => request.status === "pending"))
    issues.push("projectEditsRequested");
  if (project.membershipDiffers && !project.membershipResolution)
    issues.push("projectParticipantsDiffer");
  if (project.unresolvedCount > 0 || project.possibleDuplicates?.length)
    issues.push("projectUnknownIdentity");
  if (project.teamSizeViolation)
    issues.push(project.unresolvedCount ? "projectPossibleTeamSize" : "projectTeamSizeViolation");
  if (project.rejectedClaims) issues.push("projectRejectedClaim");
  if (project.status === "not_submitted") issues.push("projectNotSubmitted");
  if (project.status === "draft" && project.submittedAt) issues.push("projectReopened");
  return issues;
}

export function reconciliationRows(data: {
  projects: ProjectSubmission[];
  planned: Array<{ id: number; name: string; code: string; status: string }>;
}): ReconciliationRow[] {
  return [
    ...data.projects.map(
      (project): ReconciliationRow => ({
        key: `repo:${project.id}`,
        id: project.id,
        name: project.name,
        code: project.code,
        status: project.status,
        source: project.devpostUrl ? (project.internal.length ? "hybrid" : "devpost") : "native",
        issues: issuesForProject(project),
        project,
      }),
    ),
    ...data.planned.map(
      (project): ReconciliationRow => ({
        ...project,
        key: `group:${project.id}`,
        source: "planning",
        issues: project.status === "not_submitted" ? ["projectNotSubmitted"] : [],
      }),
    ),
  ];
}

export function filterReconciliationRows(
  rows: ReconciliationRow[],
  query: string,
  scope: string,
  sources: string[],
  issues: string[],
): ReconciliationRow[] {
  const search = query.trim().replace(/\s+/g, " ").toLocaleLowerCase();
  return rows.filter(
    (row) =>
      (scope !== "issues" || row.issues.length > 0) &&
      (!sources.length || sources.includes(row.source)) &&
      (!issues.length || row.issues.some((issue) => issues.includes(issue))) &&
      (!search ||
        `${row.name} ${row.code} ${[...(row.project?.internal ?? []), ...(row.project?.external ?? [])].map((member) => `${member.name ?? ""} ${member.surname ?? ""} ${member.email ?? ""}`).join(" ")}`
          .toLocaleLowerCase()
          .includes(search)),
  );
}
