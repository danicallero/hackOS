"use client";

// Projects list (H20 read-only view). Repos imported from Devpost with team
// size, mapped challenges / prizes and a matched-vs-unmatched indicator.

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS } from "@hackos/shared/events";
import { FolderGitIcon, LockIcon, UploadIcon, UsersIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { type Column, DataTable } from "@/components/common/data-table";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { ApiError } from "@/lib/api";
import { listRepos } from "@/lib/projects";
import { useSessionContext } from "@/lib/session";
import { type ProjectRepo, toProjectRepo } from "./shared";

function manualCount(repo: ProjectRepo): number {
  return repo.members.filter((m) => m.mergeStatus === "manual").length;
}

const columns: Column<ProjectRepo>[] = [
  {
    id: "name",
    header: "Project",
    sortValue: (r) => r.name.toLowerCase(),
    cell: (r) => <span className="font-medium">{r.name}</span>,
  },
  {
    id: "team",
    header: "Team",
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
    header: "Challenges",
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
    header: "Prizes",
    sortValue: (r) => r.prizes.length,
    cell: (r) =>
      r.prizes.length === 0 ? (
        <span className="text-muted-foreground text-sm">—</span>
      ) : (
        <span className="text-muted-foreground text-sm">
          {r.prizes.length} prize{r.prizes.length > 1 ? "s" : ""}
        </span>
      ),
  },
  {
    id: "matched",
    header: "Team",
    align: "center",
    sortValue: (r) => manualCount(r),
    cell: (r) => {
      const manual = manualCount(r);
      if (r.members.length === 0)
        return <span className="text-muted-foreground text-sm">No members</span>;
      return manual === 0 ? (
        <StatusBadge tone="success">All linked</StatusBadge>
      ) : (
        <StatusBadge tone="warning">{manual} manual</StatusBadge>
      );
    },
  },
];

export default function ProjectsPage() {
  const router = useRouter();
  const { can, canAny, me } = useSessionContext();
  const canImport = can(CAPABILITIES.PROJECTS_IMPORT);
  // H8/H55: judges + sponsor reps get a scoped list from the backend; full
  // access via projects:read / projects:import.
  const canView =
    canAny(CAPABILITIES.PROJECTS_READ, CAPABILITIES.PROJECTS_IMPORT, CAPABILITIES.JUDGE_PANEL) ||
    me?.role === "sponsor";
  const [repos, setRepos] = useState<ProjectRepo[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!canView) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await listRepos();
      setRepos(res.repos.map(toProjectRepo));
    } catch (err) {
      setRepos([]);
      toast.error(err instanceof ApiError ? err.message : "Could not load projects.");
    } finally {
      setLoading(false);
    }
  }, [canView]);

  // Soft, in-place refresh instead of a hard reload when a project changes
  // elsewhere.
  const liveRefresh = useAutoRefresh("/api/events/stream", [EVENTS.DATA_CHANGED]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: liveRefresh is a ping-only nonce, intentionally added to retrigger this effect.
  useEffect(() => {
    void load();
  }, [load, liveRefresh]);

  if (!canView) {
    return (
      <div className="space-y-6">
        <PageHeader title="Projects" />
        <EmptyState
          icon={LockIcon}
          title="You can't access projects"
          description="Project access requires the projects:read capability."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Projects"
        description="Devpost submissions imported into hackOS, with teams, challenges and prizes."
        actions={
          canImport ? (
            <Button onClick={() => router.push("/projects/import")}>
              <UploadIcon className="size-4" />
              Import from Devpost
            </Button>
          ) : undefined
        }
      />

      <DataTable
        columns={columns}
        data={repos}
        getRowId={(r) => String(r.id)}
        onRowClick={(r) => router.push(`/projects/${r.id}`)}
        searchable={(r) =>
          `${r.name} ${r.prizes.join(" ")} ${r.challenges.map((c) => c.title).join(" ")} ${r.members
            .map((m) => `${m.name ?? ""} ${m.surname ?? ""} ${m.email}`)
            .join(" ")}`
        }
        searchPlaceholder="Search projects…"
        pageSize={15}
        loading={loading}
        empty={{
          icon: FolderGitIcon,
          title: "No projects yet",
          description: canImport
            ? "Import the Devpost projects and participants exports to get started."
            : "Projects appear here once an organizer imports the Devpost export.",
        }}
      />
    </div>
  );
}
