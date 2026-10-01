"use client";
import { EVENTS } from "@hackos/shared/events";
import { FolderGitIcon, UserPlusIcon } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AlertModal } from "@/components/common/alert-modal";
import { ContextualError } from "@/components/common/contextual-error";
import { EmptyState } from "@/components/common/empty-state";
import { EntityCombobox } from "@/components/common/entity-combobox";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { SidePanelEditor } from "@/components/common/side-panel-editor";
import { Spinner } from "@/components/common/spinner";
import { ProjectDescriptionLinks } from "@/components/projects/project-description-links";
import { ProjectNavigation } from "@/components/projects/project-navigation";
import { WorkGroupField as Field, WorkGroupEditor } from "@/components/projects/work-group-editor";
import { Button } from "@/components/ui/button";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import {
  addWorkGroupChallenge,
  deleteWorkGroup,
  getMyWorkGroup,
  inviteWorkGroupMember,
  myProjects,
  type PlannedWorkGroup,
  removeWorkGroupChallenge,
  removeWorkGroupMember,
  respondWorkGroupInvite,
} from "@/lib/projects";
import { useMe } from "@/lib/session";
import { showErrorToast, toast } from "@/lib/toast";
import { type ChallengeOption, challengeTitleText } from "../../../projects/shared";

export default function WorkGroupDetailPage() {
  const { t } = useLocale();
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const router = useRouter();
  const me = useMe();
  const [responding, setResponding] = useState(false);
  const [group, setGroup] = useState<PlannedWorkGroup | null>(null);
  const [challenges, setChallenges] = useState<ChallengeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [next, catalogue] = await Promise.all([
        getMyWorkGroup(id),
        api.get<{ items: ChallengeOption[] }>("/api/public/challenges"),
      ]);
      setGroup(next);
      setChallenges(catalogue.items);
      if (next.linked_repo_id != null) {
        const mine = await myProjects();
        if (mine.projects.some((project) => project.id === next.linked_repo_id)) {
          router.replace(`/my-project/projects/${next.linked_repo_id}`);
        }
      }
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("couldNotLoadProject"));
      setLoadError(error instanceof ApiError ? error.message : t("couldNotLoadProject"));
      setGroup(null);
    } finally {
      setLoading(false);
    }
  }, [id, router, t]);
  const liveRefresh = useAutoRefresh("/api/events/stream?topic=projects", [EVENTS.DOMAIN_CHANGED]);
  const challengeRefresh = useAutoRefresh("/api/events/stream?topic=sponsors", [
    EVENTS.DOMAIN_CHANGED,
  ]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: project mutations may establish the import link (#854).
  useEffect(() => {
    void load();
  }, [load, liveRefresh, challengeRefresh]);
  if (loading)
    return (
      <div className="flex min-h-80 items-center justify-center">
        <Spinner />
      </div>
    );
  if (loadError) return <ContextualError message={loadError} onRetry={load} />;
  if (!group) return <EmptyState icon={FolderGitIcon} title={t("projectNotFoundTitle")} />;
  const active = group.members.some(
    (member) => member.userId === me?.id && member.status === "active",
  );
  async function respond(action: "accept" | "decline") {
    if (!group) return;
    setResponding(true);
    try {
      await respondWorkGroupInvite(group.id, action, crypto.randomUUID());
      if (action === "decline") router.replace("/my-project");
      else await load();
    } catch (error) {
      setLoadError(error instanceof ApiError ? error.message : t("couldNotSaveProject"));
    } finally {
      setResponding(false);
    }
  }
  return (
    <div className="space-y-6">
      <PageHeader
        title={group.name}
        meta={`${t("workGroupTiming")}: ${t(group.presentation_timing_preference === "early" ? "workGroupTimingEarly" : group.presentation_timing_preference === "middle" ? "workGroupTimingMiddle" : group.presentation_timing_preference === "late" ? "workGroupTimingLate" : "workGroupTimingNone")}`}
        secondaryActions={
          active && !group.linked_repo_id ? (
            <DeleteGroup group={group} onDeleted={() => router.replace("/my-project")} />
          ) : (
            <ProjectNavigation />
          )
        }
        primaryAction={
          active ? (
            <WorkGroupEditor key={JSON.stringify(group)} group={group} onSaved={load} />
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button disabled={responding} onClick={() => respond("accept")}>
                {t("acceptInvite")}
              </Button>
              <Button variant="outline" disabled={responding} onClick={() => respond("decline")}>
                {t("declineInvite")}
              </Button>
            </div>
          )
        }
      />
      <ProjectDescriptionLinks
        description={group.description}
        links={{
          devpostUrl: group.devpost_url,
          demoUrl: group.demo_url,
          githubUrl: group.github_url,
        }}
      />
      <div className="grid gap-8 xl:grid-cols-3 xl:gap-12">
        <Members group={group} onChanged={load} editable={active} />
        <Challenges group={group} challenges={challenges} onChanged={load} editable={active} />
      </div>
    </div>
  );
}

function Members({
  group,
  onChanged,
  editable,
}: {
  group: PlannedWorkGroup;
  onChanged: () => Promise<void>;
  editable: boolean;
}) {
  const { t } = useLocale();
  const me = useMe();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [memberError, setMemberError] = useState<string | null>(null);
  async function invite() {
    setBusy(true);
    try {
      await inviteWorkGroupMember(group.id, email, crypto.randomUUID());
      setEmail("");
      await onChanged();
    } catch (error) {
      if (error instanceof ApiError && (error.status === 404 || error.status === 403)) {
        showErrorToast(error, t("couldNotInvite"), {
          description: t("inviteAcceptedParticipantRequired"),
        });
      } else {
        toast.error(error instanceof ApiError ? error.message : t("couldNotSendInvite"));
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <SectionCard
      variant="plain"
      title={t("teamSectionTitle")}
      action={
        editable ? (
          <SidePanelEditor
            trigger={
              <Button variant="outline" size="sm">
                <UserPlusIcon className="size-4" />
                {t("inviteMemberCta")}
              </Button>
            }
            title={t("inviteMemberTitle")}
            footer={
              <Button disabled={busy || !email.trim()} onClick={invite}>
                {t("inviteMemberCta")}
              </Button>
            }
          >
            <Field
              id="group-invite"
              label={t("inviteEmailLabel")}
              value={email}
              onChange={setEmail}
              type="email"
            />
          </SidePanelEditor>
        ) : undefined
      }
    >
      <ul className="divide-y divide-border/60">
        {group.members.map((member) => (
          <li
            className="flex flex-wrap items-start justify-between gap-3 py-2 text-sm"
            key={member.userId}
          >
            <span className="font-medium">
              {[member.name, member.surname].filter(Boolean).join(" ") || t("unnamedTeamMember")}
            </span>
            <div className="flex items-center gap-2">
              {member.status !== "active" && (
                <span className="text-xs text-muted-foreground">
                  {t(
                    member.status === "invited"
                      ? "workGroupMemberInvited"
                      : "workGroupMemberDeclined",
                  )}
                </span>
              )}
              {editable && member.userId !== me?.id && (
                <Button
                  disabled={busy}
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    setBusy(true);
                    setMemberError(null);
                    try {
                      await removeWorkGroupMember(group.id, member.userId, crypto.randomUUID());
                      await onChanged();
                    } catch (error) {
                      setMemberError(
                        error instanceof ApiError ? error.message : t("couldNotSaveProject"),
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {t("remove")}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {memberError && <ContextualError message={memberError} />}
    </SectionCard>
  );
}
function Challenges({
  group,
  challenges,
  onChanged,
  editable,
}: {
  group: PlannedWorkGroup;
  challenges: ChallengeOption[];
  onChanged: () => Promise<void>;
  editable: boolean;
}) {
  const { t } = useLocale();
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function change(challengeId: number, remove = false) {
    setBusy(true);
    setError(null);
    try {
      if (remove) await removeWorkGroupChallenge(group.id, challengeId, crypto.randomUUID());
      else await addWorkGroupChallenge(group.id, challengeId, crypto.randomUUID());
      setSelected("");
      await onChanged();
    } catch (error) {
      setError(error instanceof ApiError ? error.message : t("couldNotSaveProject"));
    } finally {
      setBusy(false);
    }
  }
  const available = challenges.filter(
    (challenge) => !group.challenges.some((item) => item.id === challenge.id),
  );
  return (
    <SectionCard
      variant="plain"
      className="xl:col-span-2"
      title={t("challenges")}
      footer={
        editable && available.length ? (
          <div className="flex gap-2">
            <EntityCombobox
              className="min-w-0 flex-1"
              options={available}
              getId={(challenge) => challenge.id}
              getLabel={(challenge) => challengeTitleText(challenge.title)}
              value={selected}
              placeholder={t("selectChallengePlaceholder")}
              onChange={setSelected}
              disabled={busy}
            />
            <Button disabled={busy || !selected} onClick={() => change(Number(selected))}>
              {t("addAction")}
            </Button>
          </div>
        ) : undefined
      }
    >
      <ul className="divide-y divide-border/60">
        {group.challenges.map((challenge) => (
          <li
            key={challenge.id}
            className="flex flex-wrap items-center justify-between gap-3 py-4 first:pt-0 last:pb-0 text-sm"
          >
            <h3 className="text-base font-medium text-balance">
              {challengeTitleText(challenge.title)}
            </h3>
            {challenge.mandatory ? (
              <span className="text-xs text-muted-foreground">{t("mandatoryChallengeLabel")}</span>
            ) : editable ? (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => change(challenge.id, true)}
              >
                {t("remove")}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {error && <ContextualError message={error} />}
    </SectionCard>
  );
}
function DeleteGroup({ group, onDeleted }: { group: PlannedWorkGroup; onDeleted: () => void }) {
  const { t } = useLocale();
  const [pending, setPending] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <ProjectNavigation
        onDelete={() => {
          setError(null);
          setOpen(true);
        }}
      />
      <AlertModal
        open={open}
        onOpenChange={setOpen}
        title={t("deleteWorkGroupTitle")}
        description={t("deleteWorkGroupDesc")}
        cancelLabel={t("cancel")}
        confirmLabel={t("deleteWorkGroupCta")}
        destructive
        pending={pending}
        onConfirm={async () => {
          setPending(true);
          try {
            await deleteWorkGroup(group.id, crypto.randomUUID());
            setOpen(false);
            onDeleted();
          } catch (error) {
            setError(error instanceof ApiError ? error.message : t("couldNotDeleteProject"));
          } finally {
            setPending(false);
          }
        }}
      >
        {error && <ContextualError message={error} />}
      </AlertModal>
    </>
  );
}
