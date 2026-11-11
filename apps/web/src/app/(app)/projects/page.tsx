"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import Link from "next/link";
import { useState } from "react";
import { AccessDenied } from "@/components/common/access-denied";
import { type Column, DataTable } from "@/components/common/data-table";
import { ListToolbar } from "@/components/common/list-toolbar";
import { PageLayout } from "@/components/common/page-layout";
import { ProjectsSectionHeader } from "@/components/common/section-navigation";
import { StatusBadge } from "@/components/common/status-badge";
import { CreateProjectPanel } from "@/components/projects/create-project-panel";
import { ProjectListRow } from "@/components/projects/project-list-row";
import { Button } from "@/components/ui/button";
import { useServerResource } from "@/hooks/use-server-resource";
import { api } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import { API_URL } from "@/lib/env";
import { useLocale } from "@/lib/i18n";
import type { NativeProject } from "@/lib/native-projects";
import { useSessionContext } from "@/lib/session";

export default function ProjectsPage() {
  const { t } = useLocale();
  const { can, canAny, me } = useSessionContext();
  const canEdit = can(CAPABILITIES.PROJECTS_EDIT);
  const allowed =
    canAny(CAPABILITIES.PROJECTS_READ, CAPABILITIES.PROJECTS_EDIT) ||
    Boolean(me?.isEnterpriseJudge || me?.isSponsorRep);
  const [createOpen, setCreateOpen] = useState(false);
  const [search, setSearch] = useState("");
  const resource = useServerResource(
    ["projects", "management"],
    (signal) => api.get<{ repos: NativeProject[] }>("/api/repos", { signal }),
    { enabled: allowed },
  );
  const activity = useServerResource(
    ["projects", "github-activity"],
    (signal) =>
      api.get<{
        teams: { repoId: number; commits: number; pullRequests: number }[];
      }>("/api/projects/github-activity", { signal }),
    { enabled: can(CAPABILITIES.PROJECTS_READ) },
  );
  const activityOf = new Map((activity.data?.teams ?? []).map((team) => [team.repoId, team]));
  const projects = resource.data?.repos ?? [];
  const columns: Column<NativeProject>[] = [
    {
      id: "name",
      header: t("projectNameLabel"),
      cell: (project) => (
        <Link href={`/projects/${project.id}`} className="wrap-anywhere font-medium">
          {project.name}
        </Link>
      ),
    },
    {
      id: "members",
      header: t("surfaceTeam"),
      cell: (project) =>
        project.members
          ?.filter((member) => member.status === "active")
          .map((member) => member.name)
          .join(", "),
    },
    {
      id: "status",
      header: t("inviteStatus"),
      cell: (project) => (
        <StatusBadge
          tone={project.submissionStatus === "submitted" ? "success" : "neutral"}
          dot={false}
        >
          {t(project.submissionStatus === "submitted" ? "dataStatusSubmitted" : "dataStatusDraft")}
        </StatusBadge>
      ),
    },
    ...(activity.data
      ? [
          {
            id: "commits",
            header: t("githubCommits"),
            align: "right" as const,
            sortValue: (project: NativeProject) => activityOf.get(project.id)?.commits ?? -1,
            cell: (project: NativeProject) => activityOf.get(project.id)?.commits ?? "–",
          },
          {
            id: "pullRequests",
            header: t("githubPullRequests"),
            align: "right" as const,
            sortValue: (project: NativeProject) => activityOf.get(project.id)?.pullRequests ?? -1,
            cell: (project: NativeProject) => activityOf.get(project.id)?.pullRequests ?? "–",
          },
        ]
      : []),
  ];
  if (!allowed) return <AccessDenied ask={t("projectAccessDeniedDesc")} />;
  return (
    <PageLayout>
      <ProjectsSectionHeader
        management
        secondaryActions={
          can(CAPABILITIES.EXPORTS_RUN) ? (
            <Button asChild variant="outline">
              <a href={`${API_URL}/api/exports/projects.csv`}>{t("exportCsv")}</a>
            </Button>
          ) : undefined
        }
        primaryAction={
          canEdit && <Button onClick={() => setCreateOpen(true)}>{t("staffCreateProject")}</Button>
        }
      />
      <ListToolbar
        search={{
          value: search,
          onValueChange: setSearch,
          label: t("search"),
          placeholder: t("projectNameLabel"),
        }}
      />
      <DataTable
        columns={columns}
        data={projects.filter((project) =>
          project.name.toLowerCase().includes(search.toLowerCase()),
        )}
        getRowId={(project) => String(project.id)}
        loading={resource.loading}
        error={
          resource.error
            ? {
                message: apiErrorText(resource.error, t, t("couldNotLoadProjects")),
                onRetry: resource.reload,
              }
            : undefined
        }
        empty={{ title: t("noProjectsYet") }}
        filteredEmpty={{ active: Boolean(search.trim()), onClear: () => setSearch("") }}
        renderMobileRow={(project) => (
          <>
            <ProjectListRow project={project} href={`/projects/${project.id}`} variant="plain" />
            {activity.data && (
              <dl className="flex flex-wrap gap-x-6 gap-y-2 px-4 pb-3 text-sm">
                <div className="flex items-baseline gap-2">
                  <dt className="text-muted-foreground">{t("githubCommits")}</dt>
                  <dd className="tabular-nums">{activityOf.get(project.id)?.commits ?? "–"}</dd>
                </div>
                <div className="flex items-baseline gap-2">
                  <dt className="text-muted-foreground">{t("githubPullRequests")}</dt>
                  <dd className="tabular-nums">
                    {activityOf.get(project.id)?.pullRequests ?? "–"}
                  </dd>
                </div>
              </dl>
            )}
          </>
        )}
        getRowHref={(project) => `/projects/${project.id}`}
        getRowLabel={(project) => project.name}
      />
      <CreateProjectPanel open={createOpen} onOpenChange={setCreateOpen} />
    </PageLayout>
  );
}
