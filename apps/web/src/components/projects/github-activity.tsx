"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { useServerResource } from "@/hooks/use-server-resource";
import { api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { useSessionContext } from "@/lib/session";
import { cn } from "@/lib/utils";
import { ProjectAsideBlock } from "./project-aside-block";

interface Person {
  login: string;
  name: string | null;
  commits: number;
  pullRequests: number;
  merged: number;
}

interface GithubTotals {
  commits: number;
  pullRequests: number;
  merged: number;
}

/** Commits and pull requests inside the hacking window; null for readers without project access (H18). */
export function useProjectGithubActivity(projectId: number) {
  const { can } = useSessionContext();
  const resource = useServerResource(
    ["project-github-activity", projectId],
    (signal) =>
      api.get<{ people: Person[]; totals: GithubTotals }>(
        `/api/projects/${projectId}/github-activity`,
        { signal },
      ),
    { enabled: can(CAPABILITIES.PROJECTS_READ) },
  );
  const data = resource.data;
  return data?.totals && data.totals.commits + data.totals.pullRequests > 0 ? data : null;
}

/** Commits and pull requests of each author of a project, for project staff (H18). */
export function GithubActivity({ projectId }: { projectId: number }) {
  const { t } = useLocale();
  const data = useProjectGithubActivity(projectId);
  if (!data) return null;
  const { people = [], totals } = data;
  const rows = people.length > 1 ? [...people, null] : people;
  return (
    <ProjectAsideBlock title="GitHub">
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-4 text-sm">
        <span />
        <span className="pb-1 text-right type-meta text-muted-foreground">
          {t("githubCommits")}
        </span>
        <span className="pb-1 text-right type-meta text-muted-foreground">
          {t("githubPullRequests")}
        </span>
        {rows.map((person) => {
          const row = person ?? totals;
          return (
            <div
              key={person?.login ?? "total"}
              className={cn(
                "col-span-3 grid grid-cols-subgrid items-baseline border-t py-2",
                person ? "border-border/60" : "border-border font-medium",
              )}
            >
              <span
                className="min-w-0 truncate"
                title={person ? (person.name ?? person.login) : undefined}
              >
                {person ? (person.name ?? person.login) : ""}
              </span>
              <span className="text-right tabular-nums">{row.commits}</span>
              <span className="text-right tabular-nums">{row.pullRequests}</span>
            </div>
          );
        })}
      </div>
      {totals.merged > 0 && (
        <p className="text-right text-sm text-muted-foreground tabular-nums">
          {totals.merged} {t("githubMerged")}
        </p>
      )}
    </ProjectAsideBlock>
  );
}
