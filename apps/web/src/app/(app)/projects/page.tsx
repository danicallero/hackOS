"use client";

// Projects list (H21): team size, submission state and challenge entries.

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS } from "@hackos/shared/events";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { DotsThreeIcon } from "@phosphor-icons/react/dist/csr/DotsThree";
import { FolderSimpleIcon } from "@phosphor-icons/react/dist/csr/FolderSimple";
import { UsersIcon } from "@phosphor-icons/react/dist/csr/Users";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessDenied } from "@/components/common/access-denied";
import { type Column, DataTable } from "@/components/common/data-table";
import { IconButton } from "@/components/common/icon-button";
import { PageHeader } from "@/components/common/page-header";
import { PageLayout } from "@/components/common/page-layout";
import { QueueStatusBadge } from "@/components/common/queue-status-badge";
import { StatusBadge } from "@/components/common/status-badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { ApiError } from "@/lib/api";
import { type Translate, useLocale } from "@/lib/i18n";
import { listRepos } from "@/lib/projects";
import { useSessionContext } from "@/lib/session";
import { toast } from "@/lib/toast";
import { ProjectFormDialog } from "./project-form-dialog";
import { type ProjectRepo, toProjectRepo } from "./shared";

function buildColumns(t: Translate): Column<ProjectRepo>[] {
  return [
    {
      id: "name",
      header: t("colProject"),
      sortValue: (r) => r.name.toLowerCase(),
      cell: (r) => <span className="font-medium">{r.name}</span>,
    },
    {
      id: "team",
      header: t("colTeam"),
      align: "center",
      sortValue: (r) => r.members.length,
      cell: (r) => (
        <span className="text-muted-foreground inline-flex items-center gap-1 text-sm">
          <UsersIcon aria-hidden="true" className="size-3.5" />
          {r.members.length}
        </span>
      ),
    },
    {
      id: "challenges",
      header: t("challenges"),
      sortValue: (r) => r.challenges.length,
      cell: (r) =>
        r.challenges.length === 0 ? (
          <span className="text-muted-foreground text-sm">—</span>
        ) : (
          <ul className="space-y-2 text-sm">
            {r.challenges.map((challenge) => (
              <li key={challenge.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="wrap-break-word">{challenge.title}</span>
                {challenge.status && <QueueStatusBadge status={challenge.status} />}
              </li>
            ))}
          </ul>
        ),
    },
    {
      id: "submission",
      header: t("projectSubmission"),
      sortValue: (r) => (r.submission_status === "submitted" ? 1 : 0),
      cell: (r) => (
        <StatusBadge tone={r.submission_status === "submitted" ? "success" : "neutral"}>
          {t(r.submission_status === "submitted" ? "projectSubmittedStatus" : "projectDraft")}
        </StatusBadge>
      ),
    },
  ];
}

export default function ProjectsPage() {
  const router = useRouter();
  const { t } = useLocale();
  const { can, canAny, me } = useSessionContext();
  const canEdit = can(CAPABILITIES.PROJECTS_EDIT);
  const columns = useMemo(() => buildColumns(t), [t]);
  // H8/H40/H46/H55: judges + sponsor reps get a scoped list from the backend
  // (GET /api/repos, association-aware via enterprise_judges/sponsors — see
  // resolveRepoScope), independent of capabilities; full access via
  // projects:read. isEnterpriseJudge/isSponsorRep (not the
  // single-priority `role`, which collapses a sponsor-rep-who-also-judges to
  // "judge") are what those associations actually are.
  const canView =
    canAny(CAPABILITIES.PROJECTS_READ, CAPABILITIES.JUDGE_PANEL) ||
    Boolean(me?.isEnterpriseJudge) ||
    Boolean(me?.isSponsorRep);
  const [repos, setRepos] = useState<ProjectRepo[]>([]);
  const [loading, setLoading] = useState(true);
  const hasLoadedRef = useRef(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!canView) {
      setLoading(false);
      return;
    }
    if (!hasLoadedRef.current) setLoading(true);
    setLoadError(null);
    try {
      const res = await listRepos();
      hasLoadedRef.current = true;
      setRepos(res.repos.map(toProjectRepo));
    } catch (err) {
      setRepos([]);
      const message = err instanceof ApiError ? err.message : t("couldNotLoadProjects");
      setLoadError(message);
      toast.error(message, t("projects"));
    } finally {
      setLoading(false);
    }
  }, [canView, t]);

  // Soft, in-place refresh instead of a hard reload when a project changes
  // elsewhere.
  const liveRefresh = useAutoRefresh("/api/events/stream?topic=projects", [EVENTS.DOMAIN_CHANGED]);
  const challengeRefresh = useAutoRefresh("/api/events/stream?topic=sponsors", [
    EVENTS.DOMAIN_CHANGED,
  ]);
  const queueRefresh = useAutoRefresh("/api/tv/stream", [EVENTS.DATA_CHANGED]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: liveRefresh is a ping-only nonce, intentionally added to retrigger this effect.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetching from API is a legitimate external-system sync
    void load();
  }, [load, liveRefresh, queueRefresh, challengeRefresh]);

  if (!canView) {
    return <AccessDenied ask={t("projectAccessDeniedDesc")} />;
  }

  return (
    <PageLayout>
      <PageHeader
        className="flex-row items-center justify-between gap-2 md:items-center [&>[data-slot=action-group]]:shrink-0 [&>[data-slot=action-group]]:flex-nowrap"
        title={t("projects")}
        secondaryActions={
          canEdit ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton label={t("moreActions")} variant="outline">
                  <DotsThreeIcon aria-hidden="true" />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <Link href="/projects/submissions">{t("projectSubmissions")}</Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : undefined
        }
        primaryAction={
          canEdit ? (
            <ProjectFormDialog
              mode={{ kind: "create" }}
              onSaved={(repoId) => router.push(`/projects/${repoId}`)}
            />
          ) : undefined
        }
      />

      <DataTable
        columns={columns}
        data={repos}
        getRowId={(r) => String(r.id)}
        loading={loading && !hasLoadedRef.current}
        error={loadError ? { message: loadError, onRetry: load } : undefined}
        getRowHref={(r) => `/projects/${r.id}`}
        getRowLabel={(r) => r.name}
        searchable={(r) =>
          `${r.name} ${r.challenges.map((c) => c.title).join(" ")} ${r.members
            .map((m) => `${m.name ?? ""} ${m.surname ?? ""} ${m.email ?? ""}`)
            .join(" ")}`
        }
        searchPlaceholder={t("searchProjectsPlaceholder")}
        stateKey="projects-list"
        pageSize={15}
        renderMobileRow={(repo) => (
          <Link
            href={`/projects/${repo.id}`}
            aria-label={repo.name}
            className="button-interaction flex min-w-0 items-start gap-3 px-4 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          >
            <div className="min-w-0 flex-1 space-y-2">
              <p className="font-medium wrap-break-word">{repo.name}</p>
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-sm text-muted-foreground">
                  {t("teamMemberCount", { count: repo.members.length })}
                </p>
                <StatusBadge tone={repo.submission_status === "submitted" ? "success" : "neutral"}>
                  {t(
                    repo.submission_status === "submitted"
                      ? "projectSubmittedStatus"
                      : "projectDraft",
                  )}
                </StatusBadge>
              </div>
              <div className="space-y-2">
                {repo.challenges.map((challenge) => (
                  <div key={challenge.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <p className="text-sm wrap-break-word">{challenge.title}</p>
                    {challenge.status && <QueueStatusBadge status={challenge.status} />}
                  </div>
                ))}
              </div>
            </div>
            <CaretRightIcon
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-muted-foreground"
            />
          </Link>
        )}
        empty={{ icon: FolderSimpleIcon, title: t("noProjectsYet") }}
      />
    </PageLayout>
  );
}
