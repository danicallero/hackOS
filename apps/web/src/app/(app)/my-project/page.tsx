"use client";

// A participant sees a team preparing (or presenting) to challenges. Projects,
// planned work groups and their queue status are one model, not destinations to
// reconcile mentally (H19, H20, H38, #852).
import { EVENTS } from "@hackos/shared/events";
import { FolderGitIcon, MailIcon, MapPinIcon, UsersIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { QueueStatusBadge } from "@/components/common/queue-status-badge";
import { SectionCard } from "@/components/common/section-card";
import { SidePanelEditor } from "@/components/common/side-panel-editor";
import { Spinner } from "@/components/common/spinner";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { ApiError } from "@/lib/api";
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
import { ProjectFormDialog } from "../projects/project-form-dialog";
import { challengeTitleText, type ProjectRepo, toProjectRepo } from "../projects/shared";

export default function MyProjectPage() {
  const { t } = useLocale();
  const [projects, setProjects] = useState<ProjectRepo[]>([]);
  const [groups, setGroups] = useState<PlannedWorkGroup[]>([]);
  const [queue, setQueue] = useState<MyQueueEntry[]>([]);
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [canCreate, setCanCreate] = useState(false);
  const [loading, setLoading] = useState(true);

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
      setCanCreate(projectsRes.canCreate);
      setQueue(queueRes);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("couldNotLoadProject"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const liveRefresh = useAutoRefresh("/api/events/stream?topic=projects", [EVENTS.DOMAIN_CHANGED]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: liveRefresh is a ping-only nonce.
  useEffect(() => {
    void load();
  }, [load, liveRefresh]);

  const queueByProject = useMemo(() => {
    const result = new Map<number, MyQueueEntry[]>();
    for (const entry of queue)
      result.set(entry.repoId, [...(result.get(entry.repoId) ?? []), entry]);
    return result;
  }, [queue]);

  if (loading)
    return (
      <div className="flex min-h-80 items-center justify-center">
        <Spinner />
      </div>
    );

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("myProjects")}
        primaryAction={
          <div className="flex flex-wrap gap-2">
            <CreateWorkGroup onCreated={load} />
            {canCreate && <ProjectFormDialog mode={{ kind: "self" }} onSaved={load} />}
          </div>
        }
      />
      {invites.length > 0 && <PendingInvitesCard invites={invites} onChanged={load} />}
      {projects.length === 0 && groups.length === 0 ? (
        <EmptyState
          icon={FolderGitIcon}
          title={t("myProjectsEmptyTitle")}
          description={canCreate ? t("myProjectCanCreateDesc") : t("myProjectEmptyDesc")}
        />
      ) : (
        <div className="space-y-4">
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
    </div>
  );
}

function CreateWorkGroup({ onCreated }: { onCreated: () => Promise<void> }) {
  const { t } = useLocale();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  async function create() {
    setSaving(true);
    try {
      await createWorkGroup(name.trim(), crypto.randomUUID());
      setName("");
      await onCreated();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("couldNotCreateWorkGroup"));
    } finally {
      setSaving(false);
    }
  }
  return (
    <SidePanelEditor
      trigger={<Button variant="outline">{t("createWorkGroup")}</Button>}
      title={t("createWorkGroup")}
      footer={
        <Button disabled={saving || !name.trim()} onClick={create}>
          {t("createWorkGroup")}
        </Button>
      }
    >
      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="work-group-name">
          {t("workGroupName")}
        </label>
        <Input
          id="work-group-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
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
      icon={FolderGitIcon}
      action={
        <Button asChild size="sm" variant="outline">
          <Link href={`/my-project/projects/${project.id}`}>{t("openProject")}</Link>
        </Button>
      }
    >
      <div className="space-y-3">
        {entries.map((entry) => (
          <QueueChallengeRow entry={entry} key={entry.entryId} />
        ))}
        {project.challenges
          .filter((challenge) => !queuedChallengeIds.has(challenge.id))
          .map((challenge) => (
            <ChallengeRow
              key={challenge.id}
              title={challengeTitleText(challenge.title)}
              status={challenge.status}
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
      icon={UsersIcon}
      state={
        <StatusBadge tone={group.linked_repo_id ? "success" : "neutral"}>
          {group.linked_repo_id ? t("projectBadge") : t("workGroupBadge")}
        </StatusBadge>
      }
      action={
        <Button asChild size="sm" variant="outline">
          <Link href={`/my-project/work-groups/${group.id}`}>{t("openProject")}</Link>
        </Button>
      }
    >
      <p className="text-sm text-muted-foreground">{t("workGroupMembers", { count: members })}</p>
      <div className="mt-3 space-y-3">
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

function ChallengeRow({ title, status }: { title: string; status?: string | null }) {
  const { t } = useLocale();
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
      <span className="min-w-0 truncate font-medium">{title}</span>
      {status ? (
        <QueueStatusBadge status={status} />
      ) : (
        <StatusBadge tone="neutral">{t("plannedChallenge")}</StatusBadge>
      )}
    </div>
  );
}

function QueueChallengeRow({ entry }: { entry: MyQueueEntry }) {
  const { t } = useLocale();
  const room = entry.status === "waiting" ? entry.rooms[0] : entry.room;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
      <span className="min-w-0 truncate font-medium">
        {challengeTitleText(entry.challengeTitle)}
      </span>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
        {entry.status === "waiting" && entry.position != null && (
          <span className="tabular-nums">
            {t("position")} #{entry.position}
          </span>
        )}
        {room && (
          <span className="inline-flex items-center gap-1">
            <MapPinIcon className="size-3.5" />
            {room.name}
          </span>
        )}
        <QueueStatusBadge status={entry.status} />
      </div>
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
      toast.error(error instanceof ApiError ? error.message : t("couldNotLoadProject"));
    } finally {
      setBusy(null);
    }
  }
  return (
    <SectionCard title={t("pendingInvitesTitle")} icon={MailIcon}>
      <ul className="space-y-3">
        {invites.map((invite) => (
          <li
            className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
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
              >
                {t("acceptInvite")}
              </Button>
              <Button
                disabled={busy === invite.repoId}
                onClick={() => respond(invite.repoId, "decline")}
                size="sm"
                variant="outline"
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
