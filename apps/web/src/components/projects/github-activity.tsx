"use client";

import { GitCommitIcon } from "@phosphor-icons/react/dist/csr/GitCommit";
import { SectionCard } from "@/components/common/section-card";
import { useServerResource } from "@/hooks/use-server-resource";
import { api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";

interface Person {
  login: string;
  name: string | null;
  commits: number;
  pullRequests: number;
  merged: number;
}

/** Commits and pull requests of each author of a project, for project staff (H18). */
export function GithubActivity({ projectId }: { projectId: number }) {
  const { t } = useLocale();
  const resource = useServerResource(["project-github-activity", projectId], (signal) =>
    api.get<{ people: Person[] }>(`/api/projects/${projectId}/github-activity`, { signal }),
  );
  const people = resource.data?.people ?? [];
  if (people.length === 0) return null;
  return (
    <SectionCard title="GitHub" icon={GitCommitIcon} variant="plain">
      <table className="w-full text-sm">
        <thead className="text-muted-foreground text-left">
          <tr>
            <th className="pb-2 font-normal" />
            <th className="pb-2 text-right font-normal">{t("githubCommits")}</th>
            <th className="pb-2 text-right font-normal">{t("githubPullRequests")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {people.map((person) => (
            <tr key={person.login}>
              <td className="max-w-0 truncate py-2 pr-3 font-medium">
                {person.name ?? person.login}
              </td>
              <td className="py-2 text-right tabular-nums">{person.commits}</td>
              <td className="py-2 text-right tabular-nums">
                {person.pullRequests}
                {person.merged > 0 && (
                  <span className="text-muted-foreground">
                    {" "}
                    · {person.merged} {t("githubMerged")}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </SectionCard>
  );
}
