"use client";

// A participant sees a team preparing (or presenting) to challenges. Projects,
// planned work groups and their queue status are one model, not destinations to
// reconcile mentally (H19, H20, H38, #852).
import { EVENTS } from "@hackos/shared/events";
import { EnvelopeSimpleIcon } from "@phosphor-icons/react/dist/csr/EnvelopeSimple";
import { FolderSimpleIcon } from "@phosphor-icons/react/dist/csr/FolderSimple";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ComponentProps, useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/common/empty-state";
import { MultiSelect, type MultiSelectOption } from "@/components/common/multi-select";
import { PageHeader } from "@/components/common/page-header";
import { PageLayout } from "@/components/common/page-layout";
import { SectionCard } from "@/components/common/section-card";
import { SidePanelEditor } from "@/components/common/side-panel-editor";
import { Spinner } from "@/components/common/spinner";
import { PresentationStatus } from "@/components/projects/presentation-status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import {
  acceptProjectInvite,
  createWorkGroup,
  declineProjectInvite,
  myPendingInvites,
  myProjects,
  myWorkGroups,
  type PendingInvite,
  type PlannedWorkGroup,
} from "@/lib/projects";
import { getMyQueue, type MyQueueEntry } from "@/lib/queue";
import { toast } from "@/lib/toast";
import {
  type ChallengeOption,
  challengeTitleText,
  type ProjectRepo,
  toProjectRepo,
} from "../projects/shared";

export default function MyProjectPage() {
  const { t } = useLocale();
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectRepo[]>([]);
  const [groups, setGroups] = useState<PlannedWorkGroup[]>([]);
  const [queue, setQueue] = useState<MyQueueEntry[]>([]);
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [canCreate, setCanCreate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [redirecting, setRedirecting] = useState(false);

  const load = useCallback(async () => {
    try {
      const [projectsRes, groupsRes, invitesRes, queueRes] = await Promise.all([
        myProjects(),
        myWorkGroups(),
        myPendingInvites(),
        getMyQueue(),
      ]);
      setProjects(projectsRes.projects.map(toProjectRepo));
      setGroups(groupsRes.groups);
      setInvites(invitesRes.invites);
      setCanCreate(groupsRes.canCreate);
      setQueue(queueRes);
      const unlinkedGroups = groupsRes.groups.filter(
        (group) => !projectsRes.projects.some((project) => project.id === group.linked_repo_id),
      );
      if (
        new URLSearchParams(window.location.search).get("view") !== "all" &&
        invitesRes.invites.length === 0 &&
        projectsRes.projects.length + unlinkedGroups.length === 1
      ) {
        setRedirecting(true);
        router.replace(
          projectsRes.projects.length === 1
            ? `/my-project/projects/${projectsRes.projects[0].id}`
            : `/my-project/work-groups/${unlinkedGroups[0].id}`,
        );
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
        primaryAction={canCreate ? <CreateWorkGroup onCreated={load} /> : undefined}
      />
      {invites.length > 0 && <PendingInvitesCard invites={invites} onChanged={load} />}
      {projects.length === 0 && groups.length === 0 ? (
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
          {groups
            // Once an exact Devpost match turns a planned group into one of the
            // caller's projects, show its operational card once rather than
            // making participants choose between two representations.
            .filter(
              (group) =>
                group.linked_repo_id == null ||
                !projects.some((project) => project.id === group.linked_repo_id),
            )
            .map((group) => (
              <WorkGroupCard group={group} key={group.id} />
            ))}
        </div>
      )}
    </PageLayout>
  );
}

function CreateWorkGroup({ onCreated }: { onCreated: () => Promise<void> }) {
  const { t } = useLocale();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [challengeIds, setChallengeIds] = useState<string[]>([]);
  const [challenges, setChallenges] = useState<ChallengeOption[]>([]);
  useEffect(() => {
    if (!open) return;
    api
      .get<{ items: ChallengeOption[] }>("/api/public/challenges")
      .then((result) => setChallenges(result.items))
      .catch(() => setChallenges([]));
  }, [open]);
  async function create() {
    setSaving(true);
    try {
      await createWorkGroup(name.trim(), challengeIds.map(Number), crypto.randomUUID());
      setName("");
      setChallengeIds([]);
      setOpen(false);
      await onCreated();
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : t("couldNotCreateWorkGroup"),
        t("toastCreateProject"),
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <SidePanelEditor
      open={open}
      onOpenChange={setOpen}
      trigger={<Button>{t("createMyProjectCta")}</Button>}
      title={t("createMyProjectCta")}
      footer={
        <Button disabled={saving || !name.trim()} onClick={create} loading={saving}>
          {t("createMyProjectCta")}
        </Button>
      }
    >
      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="work-group-name">
          {t("projectNameLabel")}
        </label>
        <Input
          id="work-group-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <div className="mt-4 space-y-2">
        <label className="text-sm font-medium" htmlFor="work-group-challenges">
          {t("challenges")}
        </label>
        <MultiSelect
          inDialog
          id="work-group-challenges"
          options={challenges.map(
            (challenge): MultiSelectOption => ({
              value: String(challenge.id),
              label: challengeTitleText(challenge.title),
            }),
          )}
          value={challengeIds}
          onChange={setChallengeIds}
          placeholder={t("selectChallengePlaceholder")}
        />
      </div>
    </SidePanelEditor>
  );
}

function ProjectCard({ project, entries }: { project: ProjectRepo; entries: MyQueueEntry[] }) {
  const { t } = useLocale();
  const queuedChallengeIds = new Set(entries.map((entry) => entry.challengeId));
  return (
    <SectionCard
      title={project.name}
      action={
        <Button asChild size="sm" variant="outline">
          <Link href={`/my-project/projects/${project.id}`}>{t("openProject")}</Link>
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

function WorkGroupCard({ group }: { group: PlannedWorkGroup }) {
  const { t } = useLocale();
  const members = group.members.filter((member) => member.status === "active").length;
  return (
    <SectionCard
      title={group.name}
      action={
        <Button asChild size="sm" variant="outline">
          <Link href={`/my-project/work-groups/${group.id}`}>{t("openProject")}</Link>
        </Button>
      }
    >
      <p className="text-sm text-muted-foreground">{t("workGroupMembers", { count: members })}</p>
      <div className="mt-3 divide-y divide-border/60">
        {group.challenges.map((challenge) => (
          <ChallengeRow key={challenge.id} title={challengeTitleText(challenge.title)} />
        ))}
        {group.challenges.length === 0 && (
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
    <div className="flex flex-wrap items-center justify-between gap-3 py-2">
      <span className="min-w-0 truncate font-medium">{title}</span>
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
    <div className="flex flex-wrap items-center justify-between gap-3 py-2">
      <span className="min-w-0 truncate font-medium">
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
          <li
            className="flex flex-wrap items-center justify-between gap-3 py-2"
            key={invite.repoId}
          >
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
