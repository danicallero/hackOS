"use client";

// Participant project self-view (H20): my project, its team and the
// challenges it enters — read-only. When the event enables H19, a
// participant without a project can create one here.

import { EVENTS } from "@hackos/shared/events";
import { ExternalLinkIcon, FolderGitIcon, TrophyIcon, UsersIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { QueueStatusBadge } from "@/components/common/queue-status-badge";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { ApiError } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { myProjects } from "@/lib/projects";
import { ProjectFormDialog } from "../projects/project-form-dialog";
import {
  challengeTitleText,
  memberName,
  type ProjectRepo,
  toProjectRepo,
} from "../projects/shared";

export default function MyProjectPage() {
  const { t } = useLocale();
  const [projects, setProjects] = useState<ProjectRepo[]>([]);
  const [canCreate, setCanCreate] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await myProjects();
      setProjects(res.projects.map(toProjectRepo));
      setCanCreate(res.canCreate);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotLoadProject"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const liveRefresh = useAutoRefresh("/api/events/stream", [EVENTS.DATA_CHANGED]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: liveRefresh is a ping-only nonce, intentionally added to retrigger this effect.
  useEffect(() => {
    void load();
  }, [load, liveRefresh]);

  if (loading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("myProject")}
        description={t("myProjectDesc")}
        actions={
          canCreate ? <ProjectFormDialog mode={{ kind: "self" }} onSaved={load} /> : undefined
        }
      />

      {projects.length === 0 ? (
        <EmptyState
          icon={FolderGitIcon}
          title={t("myProjectEmptyTitle")}
          description={canCreate ? t("myProjectCanCreateDesc") : t("myProjectEmptyDesc")}
        />
      ) : (
        projects.map((repo) => <MyProjectCard key={repo.id} repo={repo} />)
      )}
    </div>
  );
}

function MyProjectCard({ repo }: { repo: ProjectRepo }) {
  const { t } = useLocale();
  const links = [
    { label: "Devpost", href: repo.devpost_url },
    { label: "Demo", href: repo.demo_url },
    { label: "Repository", href: repo.github_url },
  ].filter((l): l is { label: string; href: string } => Boolean(l.href));

  return (
    <div className="space-y-5">
      <SectionCard title={repo.name} icon={FolderGitIcon} bodyClassName="space-y-3">
        {repo.description && (
          <p className="text-muted-foreground max-w-prose text-pretty text-sm">
            {repo.description}
          </p>
        )}
        {links.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {links.map((link) => (
              <Button key={link.label} variant="outline" size="sm" asChild>
                <a href={link.href} target="_blank" rel="noreferrer">
                  <ExternalLinkIcon className="size-4" />
                  {link.label}
                </a>
              </Button>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">{t("noLinksProject")}</p>
        )}
      </SectionCard>

      <div className="grid gap-5 xl:grid-cols-2">
        <SectionCard title={t("teamSectionTitle")} icon={UsersIcon}>
          {repo.members.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("noMembers")}</p>
          ) : (
            <ul className="space-y-3">
              {repo.members.map((member) => (
                <li
                  key={`${member.userId ?? "devpost"}:${member.email}`}
                  className="rounded-md border p-3"
                >
                  <p className="truncate font-medium">{memberName(member)}</p>
                  <p className="text-muted-foreground truncate text-sm">{member.email}</p>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title={t("challenges")} icon={TrophyIcon}>
          {repo.challenges.length === 0 ? (
            <p className="text-muted-foreground text-sm">—</p>
          ) : (
            <ul className="space-y-3">
              {repo.challenges.map((challenge) => (
                <li key={challenge.id} className="rounded-md border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="min-w-0 truncate font-medium">
                      {challengeTitleText(challenge.title)}
                    </p>
                    {challenge.status ? (
                      <QueueStatusBadge status={challenge.status} />
                    ) : (
                      <StatusBadge tone="info">{t("prizeBadge")}</StatusBadge>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
