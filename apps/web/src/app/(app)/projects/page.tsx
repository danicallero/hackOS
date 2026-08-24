"use client";

// Projects list (H20 read-only view). Repos imported from Devpost with team
// size, mapped challenges / prizes and a matched-vs-unmatched indicator.

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS } from "@hackos/shared/events";
import { FolderGitIcon, UploadIcon, UsersIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AccessDenied } from "@/components/common/access-denied";
import { type Column, DataTable } from "@/components/common/data-table";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { ApiError } from "@/lib/api";
import { type Translate, useLocale } from "@/lib/i18n";
import { listRepos } from "@/lib/projects";
import { useSessionContext } from "@/lib/session";
import { ProjectFormDialog } from "./project-form-dialog";
import { type ProjectRepo, toProjectRepo } from "./shared";

function manualCount(repo: ProjectRepo): number {
  return repo.members.filter((m) => m.mergeStatus === "manual").length;
}

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
          <UsersIcon className="size-3.5" />
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
          <div className="flex flex-wrap gap-1">
            {r.challenges.map((c) => (
              <StatusBadge key={c.id} tone="brand" dot={false}>
                {c.title}
              </StatusBadge>
            ))}
          </div>
        ),
    },
    {
      id: "prizes",
      header: t("colPrizes"),
      sortValue: (r) => r.prizes.length,
      cell: (r) =>
        r.prizes.length === 0 ? (
          <span className="text-muted-foreground text-sm">—</span>
        ) : (
          <span className="text-muted-foreground text-sm">
            {r.prizes.length === 1
              ? t("prizeCountOne", { count: r.prizes.length })
              : t("prizeCountOther", { count: r.prizes.length })}
          </span>
        ),
    },
    {
      // Whether imported Devpost members resolved to hackOS accounts — not the
      // team size next to it, which is why it needs its own header (#299).
      id: "matched",
      header: t("colLinking"),
      align: "center",
      sortValue: (r) => manualCount(r),
      cell: (r) => {
        const manual = manualCount(r);
        if (r.members.length === 0)
          return <span className="text-muted-foreground text-sm">{t("noMembers")}</span>;
        return manual === 0 ? (
          <StatusBadge tone="success">{t("allLinked")}</StatusBadge>
        ) : (
          <StatusBadge tone="warning">{t("manualCountBadge", { count: manual })}</StatusBadge>
        );
      },
    },
  ];
}

export default function ProjectsPage() {
  const router = useRouter();
  const { t } = useLocale();
  const { can, canAny, me } = useSessionContext();
  const canImport = can(CAPABILITIES.PROJECTS_IMPORT);
  const canEdit = can(CAPABILITIES.PROJECTS_EDIT);
  const columns = useMemo(() => buildColumns(t), [t]);
  // H8/H40/H46/H55: judges + sponsor reps get a scoped list from the backend
  // (GET /api/repos, association-aware via enterprise_judges/sponsors — see
  // resolveRepoScope), independent of capabilities; full access via
  // projects:read / projects:import. isEnterpriseJudge/isSponsorRep (not the
  // single-priority `role`, which collapses a sponsor-rep-who-also-judges to
  // "judge") are what those associations actually are.
  const canView =
    canAny(CAPABILITIES.PROJECTS_READ, CAPABILITIES.PROJECTS_IMPORT, CAPABILITIES.JUDGE_PANEL) ||
    Boolean(me?.isEnterpriseJudge) ||
    Boolean(me?.isSponsorRep);
  const [repos, setRepos] = useState<ProjectRepo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!canView) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const res = await listRepos();
      setRepos(res.repos.map(toProjectRepo));
    } catch (err) {
      setRepos([]);
      const message = err instanceof ApiError ? err.message : t("couldNotLoadProjects");
      setLoadError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [canView, t]);

  // Soft, in-place refresh instead of a hard reload when a project changes
  // elsewhere.
  const liveRefresh = useAutoRefresh("/api/events/stream", [EVENTS.DATA_CHANGED]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: liveRefresh is a ping-only nonce, intentionally added to retrigger this effect.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetching from API is a legitimate external-system sync
    void load();
  }, [load, liveRefresh]);

  if (!canView) {
    return <AccessDenied ask={t("projectAccessDeniedDesc")} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("projects")}
        actions={
          canImport || canEdit ? (
            <div className="flex flex-wrap gap-2">
              {/* H18: native creation, so an event can run without Devpost. */}
              {canEdit && (
                <ProjectFormDialog
                  mode={{ kind: "create" }}
                  onSaved={(repoId) => router.push(`/projects/${repoId}`)}
                />
              )}
              {canImport && (
                <Button
                  variant={canEdit ? "outline" : "default"}
                  onClick={() => router.push("/projects/import")}
                >
                  <UploadIcon className="size-4" />
                  {t("importFromDevpost")}
                </Button>
              )}
            </div>
          ) : undefined
        }
      />

      <DataTable
        columns={columns}
        data={repos}
        getRowId={(r) => String(r.id)}
        loading={loading}
        error={loadError ? { message: loadError, onRetry: load } : undefined}
        getRowHref={(r) => `/projects/${r.id}`}
        getRowLabel={(r) => r.name}
        searchable={(r) =>
          `${r.name} ${r.prizes.join(" ")} ${r.challenges.map((c) => c.title).join(" ")} ${r.members
            .map((m) => `${m.name ?? ""} ${m.surname ?? ""} ${m.email ?? ""}`)
            .join(" ")}`
        }
        searchPlaceholder={t("searchProjectsPlaceholder")}
        pageSize={15}
        empty={{
          icon: FolderGitIcon,
          title: t("noProjectsYet"),
          description: canImport ? t("importDevpostToStart") : t("projectsAppearAfterImport"),
          action: canImport ? (
            <Button type="button" onClick={() => router.push("/projects/import")}>
              <UploadIcon aria-hidden="true" />
              {t("importFromDevpost")}
            </Button>
          ) : undefined,
        }}
      />
    </div>
  );
}
