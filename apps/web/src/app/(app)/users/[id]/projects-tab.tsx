"use client";

// The person's projects and their queue state across challenges (H16-H17).

import { ExternalLinkIcon, FolderGitIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { type Column, DataTable } from "@/components/common/data-table";
import { EmptyState } from "@/components/common/empty-state";
import { Spinner } from "@/components/common/spinner";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { type Translate, useLocale } from "@/lib/i18n";
import { type RepoWithExtras, userProjects } from "@/lib/projects";

export function buildProjectColumns(t: Translate): Column<RepoWithExtras>[] {
  return [
    {
      id: "name",
      header: t("colProject"),
      sortValue: (project) => project.name.toLowerCase(),
      cell: (project) => <span className="font-medium">{project.name}</span>,
    },
    {
      id: "challenges",
      header: t("challenges"),
      sortValue: (project) => project.challenges?.length ?? 0,
      cell: (project) =>
        project.challenges?.length ? (
          <div className="flex flex-wrap gap-1">
            {project.challenges.map((challenge) => (
              <StatusBadge key={challenge.id} tone="brand" dot={false}>
                {challenge.title}
              </StatusBadge>
            ))}
          </div>
        ) : (
          <span className="text-muted-foreground text-sm">{t("none")}</span>
        ),
    },
    {
      id: "prizes",
      header: t("colPrizes"),
      sortValue: (project) => (Array.isArray(project.prizes) ? project.prizes.length : 0),
      cell: (project) => {
        const prizes = Array.isArray(project.prizes) ? (project.prizes as string[]) : [];
        return prizes.length ? (
          <span className="text-muted-foreground text-sm">
            {prizes.length === 1
              ? t("prizeCountOne", { count: prizes.length })
              : t("prizeCountOther", { count: prizes.length })}
          </span>
        ) : (
          <span className="text-muted-foreground text-sm">{t("none")}</span>
        );
      },
    },
    {
      id: "links",
      header: t("colLinks"),
      cell: (project) => {
        const devpostUrl = typeof project.devpost_url === "string" ? project.devpost_url : null;
        const demoUrl = typeof project.demo_url === "string" ? project.demo_url : null;
        const githubUrl = typeof project.github_url === "string" ? project.github_url : null;

        return (
          <div className="flex flex-wrap gap-2">
            {devpostUrl && <ProjectLink href={devpostUrl} label="Devpost" />}
            {demoUrl && <ProjectLink href={demoUrl} label="Demo" />}
            {githubUrl && <ProjectLink href={githubUrl} label="Repo" />}
            {!devpostUrl && !demoUrl && !githubUrl && (
              <span className="text-muted-foreground text-sm">{t("none")}</span>
            )}
          </div>
        );
      },
    },
  ];
}

export function ProjectLink({ href, label }: { href: string; label: string }) {
  return (
    <Button variant="ghost" size="sm" asChild className="h-7 px-2">
      <a href={href} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
        <ExternalLinkIcon className="size-3.5" />
        {label}
      </a>
    </Button>
  );
}

export function ProjectsTab({ userId }: { userId: number }) {
  const { t } = useLocale();
  const [projects, setProjects] = useState<RepoWithExtras[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const projectColumns = useMemo(() => buildProjectColumns(t), [t]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await userProjects(userId);
      setProjects(data.projects);
    } catch (err) {
      setProjects([]);
      setError(err instanceof ApiError ? err.message : t("couldNotLoadUserProjects"));
    } finally {
      setLoading(false);
    }
  }, [userId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner className="size-6" />
      </div>
    );
  }

  if (error) {
    return (
      <EmptyState
        icon={FolderGitIcon}
        title={t("projectsCouldNotLoad")}
        description={error}
        action={
          <Button variant="outline" onClick={() => void load()}>
            {t("tryAgain")}
          </Button>
        }
      />
    );
  }

  if (projects.length === 0) {
    return (
      <EmptyState
        icon={FolderGitIcon}
        title={t("noProjectsYet")}
        description={t("projectsAppearHere")}
        action={
          <Button variant="outline" asChild>
            <Link href="/projects">{t("openProjects")}</Link>
          </Button>
        }
      />
    );
  }

  return (
    <DataTable
      columns={projectColumns}
      data={projects}
      getRowId={(project) => String(project.id)}
      getRowHref={(project) => `/projects/${project.id}`}
      getRowLabel={(project) => project.name}
      searchable={(project) =>
        `${project.name} ${(project.challenges ?? []).map((challenge) => challenge.title).join(" ")} ${
          Array.isArray(project.prizes) ? project.prizes.join(" ") : ""
        }`
      }
      searchPlaceholder={t("searchProjectsPlaceholder")}
      pageSize={10}
    />
  );
}
