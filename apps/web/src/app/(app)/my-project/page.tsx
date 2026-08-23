"use client";

// Participant project self-view (H20) plus H19/H20 self-service: when the
// event enables H19's policy AND the event's hacking window is open, a
// participant can create, edit, invite/accept/decline teammates, leave, and
// (as the sole remaining member) delete their own project — not just view it
// read-only. Product decision recorded in docs/challenges-devpost.md, which
// supersedes H20's original "no puedo modificar nada" framing; the plan
// itself (plan/historias-hackos.md) is left untouched.

import { EVENTS } from "@hackos/shared/events";
import { FolderGitIcon, MailIcon, TrophyIcon, UserPlusIcon, UsersIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertModal } from "@/components/common/alert-modal";
import { EmptyState } from "@/components/common/empty-state";
import { Modal } from "@/components/common/modal";
import { PageHeader } from "@/components/common/page-header";
import { QueueStatusBadge } from "@/components/common/queue-status-badge";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
import { StatusBadge } from "@/components/common/status-badge";
import { ProjectDescriptionLinks } from "@/components/projects/project-description-links";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { ApiError } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import {
  acceptProjectInvite,
  declineProjectInvite,
  deleteMyProject,
  inviteProjectMember,
  leaveMyProject,
  myPendingInvites,
  myProjects,
  type PendingInvite,
} from "@/lib/projects";
import { useMe } from "@/lib/session";
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
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [canCreate, setCanCreate] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [projectsRes, invitesRes] = await Promise.all([myProjects(), myPendingInvites()]);
      setProjects(projectsRes.projects.map(toProjectRepo));
      setCanCreate(projectsRes.canCreate);
      setInvites(invitesRes.invites);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotLoadProject"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const liveRefresh = useAutoRefresh("/api/events/stream", [EVENTS.DATA_CHANGED]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: liveRefresh is a ping-only nonce, intentionally added to retrigger this effect.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Fetching projects and invites from API (external-system sync)
    void load();
  }, [load, liveRefresh]);

  if (loading) {
    return (
      <div className="flex min-h-80 items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("myProject")}
        actions={
          canCreate ? <ProjectFormDialog mode={{ kind: "self" }} onSaved={load} /> : undefined
        }
      />

      {invites.length > 0 && <PendingInvitesCard invites={invites} onChanged={load} />}

      {projects.length === 0 ? (
        <EmptyState
          icon={FolderGitIcon}
          title={t("myProjectEmptyTitle")}
          description={canCreate ? t("myProjectCanCreateDesc") : t("myProjectEmptyDesc")}
        />
      ) : (
        projects.map((repo) => <MyProjectCard key={repo.id} repo={repo} onChanged={load} />)
      )}
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
      if (action === "accept") {
        await acceptProjectInvite(repoId, crypto.randomUUID());
        toast.success(t("inviteAccepted"));
      } else {
        await declineProjectInvite(repoId, crypto.randomUUID());
        toast.success(t("inviteDeclined"));
      }
      await onChanged();
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? err.message
          : t(action === "accept" ? "couldNotAcceptInvite" : "couldNotDeclineInvite"),
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <SectionCard title={t("pendingInvitesTitle")} icon={MailIcon}>
      <ul className="space-y-3">
        {invites.map((invite) => (
          <li
            key={invite.repoId}
            className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
          >
            <p className="min-w-0 truncate text-sm">
              {t("invitedToProjectLabel", {
                inviterName: invite.invitedByName ?? "",
                projectName: invite.repoName,
              })}
            </p>
            <div className="flex shrink-0 gap-2">
              <Button
                size="sm"
                disabled={busy === invite.repoId}
                onClick={() => respond(invite.repoId, "accept")}
              >
                {t("acceptInvite")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy === invite.repoId}
                onClick={() => respond(invite.repoId, "decline")}
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

function InviteMemberDialog({ repoId, onInvited }: { repoId: number; onInvited: () => void }) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);

  async function submit() {
    setPending(true);
    try {
      await inviteProjectMember(repoId, email.trim(), crypto.randomUUID());
      toast.success(t("inviteSentMsg"));
      setOpen(false);
      setEmail("");
      onInvited();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotSendInvite"));
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setEmail("");
      }}
      trigger={
        <Button variant="outline" size="sm">
          <UserPlusIcon className="size-4" /> {t("inviteMemberCta")}
        </Button>
      }
      icon={UserPlusIcon}
      title={t("inviteMemberTitle")}
      description={t("inviteMemberDesc")}
      footer={
        <Button disabled={pending || !email.trim()} onClick={submit}>
          {pending && <Spinner className="size-4" />}
          {t("inviteMemberCta")}
        </Button>
      }
    >
      <div className="space-y-2">
        <Label htmlFor="invite-email">{t("inviteEmailLabel")}</Label>
        <Input
          id="invite-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
    </Modal>
  );
}

function MyProjectCard({ repo, onChanged }: { repo: ProjectRepo; onChanged: () => Promise<void> }) {
  const { t } = useLocale();
  const me = useMe();
  const [busy, setBusy] = useState<"leave" | "delete" | null>(null);
  const isMember = repo.members.some((m) => m.userId === me?.id);
  const isSoleMember = repo.members.length === 1;

  async function leave() {
    setBusy("leave");
    try {
      await leaveMyProject(repo.id, crypto.randomUUID());
      toast.success(t("leftProjectMsg"));
      await onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotLeaveProject"));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy("delete");
    try {
      await deleteMyProject(repo.id, crypto.randomUUID());
      toast.success(t("projectDeletedMsg"));
      await onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotDeleteProject"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <SectionCard
        title={repo.name}
        icon={FolderGitIcon}
        bodyClassName="space-y-3"
        action={
          isMember ? (
            <ProjectFormDialog mode={{ kind: "self-edit", repo }} onSaved={onChanged} />
          ) : undefined
        }
      >
        <ProjectDescriptionLinks
          description={repo.description}
          links={{
            devpostUrl: repo.devpost_url,
            demoUrl: repo.demo_url,
            githubUrl: repo.github_url,
          }}
        />
      </SectionCard>

      <div className="grid gap-5 xl:grid-cols-2">
        <SectionCard
          title={t("teamSectionTitle")}
          icon={UsersIcon}
          action={
            isMember ? <InviteMemberDialog repoId={repo.id} onInvited={onChanged} /> : undefined
          }
          footer={
            isMember ? (
              <div className="flex justify-end">
                {isSoleMember ? (
                  <AlertModal
                    title={t("deleteProjectTitle")}
                    description={t("deleteProjectDesc")}
                    cancelLabel={t("cancel")}
                    confirmLabel={t("deleteProjectCta")}
                    destructive
                    pending={busy === "delete"}
                    trigger={
                      <Button variant="outline" size="sm" disabled={busy !== null}>
                        {t("deleteProjectCta")}
                      </Button>
                    }
                    onConfirm={remove}
                  />
                ) : (
                  <AlertModal
                    title={t("leaveProjectTitle")}
                    description={t("leaveProjectDesc")}
                    cancelLabel={t("cancel")}
                    confirmLabel={t("leaveProjectCta")}
                    destructive
                    pending={busy === "leave"}
                    trigger={
                      <Button variant="outline" size="sm" disabled={busy !== null}>
                        {t("leaveProjectCta")}
                      </Button>
                    }
                    onConfirm={leave}
                  />
                )}
              </div>
            ) : undefined
          }
        >
          {repo.members.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("noMembers")}</p>
          ) : (
            <ul className="space-y-3">
              {/* Teammates are listed by name only — the API redacts their
                  emails and this view never asks for contact details. */}
              {repo.members.map((member, i) => (
                <li
                  key={`${member.userId ?? "devpost"}:${member.email ?? i}`}
                  className="rounded-md border p-3"
                >
                  <p className="truncate font-medium">
                    {memberName(member) || t("unnamedTeamMember")}
                  </p>
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
