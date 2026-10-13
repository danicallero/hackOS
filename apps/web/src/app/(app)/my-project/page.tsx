"use client";

// A participant sees each project they are on — draft or submitted — with its
// challenges and queue status: one model from draft to judging (H19, H20,
// H38, #1006).
import { EVENTS } from "@hackos/shared/events";
import { EnvelopeSimpleIcon } from "@phosphor-icons/react/dist/csr/EnvelopeSimple";
import { FolderSimpleIcon } from "@phosphor-icons/react/dist/csr/FolderSimple";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ComponentProps, useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { PageLayout } from "@/components/common/page-layout";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
import { StatusBadge } from "@/components/common/status-badge";
import { PresentationStatus } from "@/components/projects/presentation-status";
import { Button } from "@/components/ui/button";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { ApiError } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import {
  acceptProjectInvite,
  declineProjectInvite,
  myPendingInvites,
  myProjects,
  type PendingInvite,
} from "@/lib/projects";
import { getMyQueue, type MyQueueEntry } from "@/lib/queue";
import { toast } from "@/lib/toast";
import { ProjectFormDialog } from "../projects/project-form-dialog";
import { challengeTitleText, type ProjectRepo, toProjectRepo } from "../projects/shared";

export default function MyProjectPage() {
  const { t } = useLocale();
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectRepo[]>([]);
  const [queue, setQueue] = useState<MyQueueEntry[]>([]);
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [canCreate, setCanCreate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [redirecting, setRedirecting] = useState(false);

  const load = useCallback(async () => {
    try {
      const [projectsRes, invitesRes, queueRes] = await Promise.all([
        myProjects(),
        myPendingInvites(),
        getMyQueue(),
      ]);
      setProjects(projectsRes.projects.map(toProjectRepo));
      setInvites(invitesRes.invites);
      setCanCreate(projectsRes.canCreate);
      setQueue(queueRes);
      const [only] = projectsRes.projects;
      if (
        new URLSearchParams(window.location.search).get("view") !== "all" &&
        invitesRes.invites.length === 0 &&
        projectsRes.projects.length === 1 &&
        only
      ) {
        setRedirecting(true);
        router.replace(`/my-project/${only.id}`);
      }
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : t("couldNotLoadProject"),
        t("projectLabel"),
      );
    } finally {
      setLoading(false);
    }
  }, [router, t]);

  const liveRefresh = useAutoRefresh("/api/events/stream?topic=projects", [EVENTS.DOMAIN_CHANGED]);
  const queueRefresh = useAutoRefresh("/api/queue/me/stream", [
    EVENTS.USER_QUEUE_CHANGED,
    EVENTS.USER_QUEUE_CALLED,
  ]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: liveRefresh is a ping-only nonce.
  useEffect(() => {
    void load();
  }, [load, liveRefresh, queueRefresh]);

  const queueByProject = useMemo(() => {
    const result = new Map<number, MyQueueEntry[]>();
    for (const entry of queue)
      result.set(entry.repoId, [...(result.get(entry.repoId) ?? []), entry]);
    return result;
  }, [queue]);

  if (loading || redirecting)
    return (
      <div className="flex min-h-80 items-center justify-center">
        <Spinner />
      </div>
    );

  return (
    <PageLayout>
      <PageHeader
        title={t("myProjects")}
        primaryAction={
          canCreate ? (
            <ProjectFormDialog
              mode={{ kind: "self" }}
              onSaved={(repoId) => router.push(`/my-project/${repoId}`)}
            />
          ) : undefined
        }
      />
      {invites.length > 0 && <PendingInvitesCard invites={invites} onChanged={load} />}
      {projects.length === 0 ? (
        <EmptyState
          icon={FolderSimpleIcon}
          title={t("myProjectsEmptyTitle")}
          description={canCreate ? t("myProjectCanCreateDesc") : t("myProjectEmptyDesc")}
        />
      ) : (
        <div className="space-y-8">
          {projects.map((project) => (
            <ProjectCard
              entries={queueByProject.get(project.id) ?? []}
              key={project.id}
              project={project}
            />
          ))}
        </div>
      )}
    </PageLayout>
  );
}

function ProjectCard({ project, entries }: { project: ProjectRepo; entries: MyQueueEntry[] }) {
  const { t } = useLocale();
  const queuedChallengeIds = new Set(entries.map((entry) => entry.challengeId));
  return (
    <SectionCard
      title={project.name}
      state={
        <StatusBadge tone={project.submission_status === "submitted" ? "success" : "neutral"}>
          {t(project.submission_status === "submitted" ? "projectSubmittedStatus" : "projectDraft")}
        </StatusBadge>
      }
      action={
        <Button asChild size="sm" variant="outline">
          <Link href={`/my-project/${project.id}`}>{t("openProject")}</Link>
        </Button>
      }
    >
      <div className="divide-y divide-border/60">
        {entries.map((entry) => (
          <QueueChallengeRow entry={entry} key={entry.entryId} />
        ))}
        {project.challenges
          .filter((challenge) => !queuedChallengeIds.has(challenge.id))
          .map((challenge) => (
            <ChallengeRow
              key={challenge.id}
              title={challengeTitleText(challenge.title)}
              presentation={challenge}
            />
          ))}
        {project.challenges.length === 0 && entries.length === 0 && (
          <p className="text-sm text-muted-foreground">{t("noChallenges")}</p>
        )}
      </div>
    </SectionCard>
  );
}

function ChallengeRow({
  title,
  presentation,
}: {
  title: string;
  presentation?: ComponentProps<typeof PresentationStatus>;
}) {
  const { t } = useLocale();
  return (
    <div className="grid min-w-0 gap-2 py-3">
      <span className="min-w-0 font-medium wrap-break-word">{title}</span>
      {presentation?.status ? (
        <PresentationStatus {...presentation} />
      ) : (
        <span className="text-sm text-muted-foreground">{t("plannedChallenge")}</span>
      )}
    </div>
  );
}

function QueueChallengeRow({ entry }: { entry: MyQueueEntry }) {
  return (
    <div className="grid min-w-0 gap-2 py-3">
      <span className="min-w-0 font-medium wrap-break-word">
        {challengeTitleText(entry.challengeTitle)}
      </span>
      <PresentationStatus {...entry} assignedRoomName={entry.room?.name} />
    </div>
  );
}

function PendingInvitesCard({
  invites,
  onChanged,
}: {
  invites: PendingInvite[];
  onChanged: () => Promise<void>;
}) {
  const { t } = useLocale();
  const [busy, setBusy] = useState<number | null>(null);
  async function respond(repoId: number, action: "accept" | "decline") {
    setBusy(repoId);
    try {
      if (action === "accept") await acceptProjectInvite(repoId, crypto.randomUUID());
      else await declineProjectInvite(repoId, crypto.randomUUID());
      await onChanged();
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : t("couldNotLoadProject"),
        t("toastReplyInvite"),
      );
    } finally {
      setBusy(null);
    }
  }
  return (
    <SectionCard variant="plain" title={t("pendingInvitesTitle")} icon={EnvelopeSimpleIcon}>
      <ul className="space-y-3">
        {invites.map((invite) => (
          <li className="grid min-w-0 gap-2 py-3" key={invite.repoId}>
            <p className="min-w-0 truncate text-sm">
              {t("invitedToProjectLabel", {
                inviterName: invite.invitedByName ?? "",
                projectName: invite.repoName,
              })}
            </p>
            <div className="flex gap-2">
              <Button
                disabled={busy === invite.repoId}
                onClick={() => respond(invite.repoId, "accept")}
                size="sm"
                loading={busy === invite.repoId}
              >
                {t("acceptInvite")}
              </Button>
              <Button
                disabled={busy === invite.repoId}
                onClick={() => respond(invite.repoId, "decline")}
                size="sm"
                variant="outline"
                loading={busy === invite.repoId}
              >
                {t("declineInvite")}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
