import type { MessageKey } from "@/lib/i18n";
import type { ProjectSubmission } from "@/lib/projects";

/** Organizer decisions a project's submission currently needs (H21). */
export function submissionIssues(project: ProjectSubmission): MessageKey[] {
  const issues: MessageKey[] = [];
  if (project.requests.some((request) => request.status === "pending"))
    issues.push("projectEditsRequested");
  if (project.teamSizeViolation) issues.push("projectTeamSizeViolation");
  if (project.status === "draft")
    issues.push(project.submittedAt ? "projectReopened" : "projectDraft");
  return issues;
}

export function filterSubmissions(
  projects: ProjectSubmission[],
  query: string,
  scope: string,
  issues: string[],
): ProjectSubmission[] {
  const search = query.trim().replace(/\s+/g, " ").toLocaleLowerCase();
  return projects.filter((project) => {
    const own = submissionIssues(project);
    return (
      (scope !== "issues" || own.length > 0) &&
      (!issues.length || own.some((issue) => issues.includes(issue))) &&
      (!search || project.name.toLocaleLowerCase().includes(search))
    );
  });
}
