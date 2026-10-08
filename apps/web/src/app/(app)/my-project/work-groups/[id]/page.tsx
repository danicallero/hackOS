"use client";
import { EVENTS } from "@hackos/shared/events";
import { FolderSimpleIcon } from "@phosphor-icons/react/dist/csr/FolderSimple";
import { UserPlusIcon } from "@phosphor-icons/react/dist/csr/UserPlus";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AlertModal } from "@/components/common/alert-modal";
import { ContextualError } from "@/components/common/contextual-error";
import { EmptyState } from "@/components/common/empty-state";
import { EntityCombobox } from "@/components/common/entity-combobox";
import { PageHeader } from "@/components/common/page-header";
import { PageLayout } from "@/components/common/page-layout";
import { PAIRED_HEADER_CLASS, SectionCard } from "@/components/common/section-card";
import { SidePanelEditor } from "@/components/common/side-panel-editor";
import { Spinner } from "@/components/common/spinner";
import { ProjectDescriptionLinks } from "@/components/projects/project-description-links";
import { ProjectNavigation } from "@/components/projects/project-navigation";
import { ProjectLifecycle } from "@/components/projects/project-submission";
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
      toast.error(
        error instanceof ApiError ? error.message : t("couldNotLoadProject"),
        t("projectLabel"),
      );
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
  if (!group) return <EmptyState icon={FolderSimpleIcon} title={t("projectNotFoundTitle")} />;
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
    <PageLayout width="reading">
      <PageHeader
        className={
          active
            ? "flex-row items-center justify-between gap-2 md:items-center [&>[data-slot=action-group]]:shrink-0 [&>[data-slot=action-group]]:flex-nowrap"
            : undefined
        }
        title={group.name}
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
              <Button disabled={responding} onClick={() => respond("accept")} loading={responding}>
                {t("acceptInvite")}
              </Button>
              <Button
                variant="outline"
                disabled={responding}
                onClick={() => respond("decline")}
                loading={responding}
              >
                {t("declineInvite")}
              </Button>
            </div>
          )
        }
      />
      <SectionCard title={t("projectDetailsTitle")}>
        <ProjectDescriptionLinks
          description={group.description}
          links={{
            devpostUrl: group.devpost_url,
            demoUrl: group.demo_url,
            githubUrl: group.github_url,
          }}
        />
      </SectionCard>
      {active ? (
        <ProjectLifecycle
          key={JSON.stringify(group)}
          id={group.id}
          name={group.name}
          stage="work-groups"
          canSubmit={group.can_submit}
          code={group.reconciliation_code}
          onChanged={load}
        >
          <div className="grid items-start gap-4 md:grid-cols-2">
            <Members group={group} onChanged={load} editable />
            <Challenges group={group} challenges={challenges} onChanged={load} editable />
          </div>
        </ProjectLifecycle>
      ) : (
        <div className="grid items-start gap-4 md:grid-cols-2">
          <Members group={group} onChanged={load} editable={false} />
          <Challenges group={group} challenges={challenges} onChanged={load} editable={false} />
        </div>
      )}
    </PageLayout>
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
          compactTitle: t("toastSendInvite"),
          description: t("inviteAcceptedParticipantRequired"),
        });
      } else {
        toast.error(
          error instanceof ApiError ? error.message : t("couldNotSendInvite"),
          t("toastSendInvite"),
        );
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <SectionCard
      title={t("teamSectionTitle")}
      headerClassName={PAIRED_HEADER_CLASS}
      action={
        editable ? (
          <SidePanelEditor
            trigger={
              <Button variant="outline" size="sm">
                <UserPlusIcon aria-hidden="true" className="size-4" />
                {t("inviteMemberCta")}
              </Button>
            }
            title={t("inviteMemberTitle")}
            footer={
              <Button disabled={busy || !email.trim()} onClick={invite} loading={busy}>
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
                  loading={busy}
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
  const [addOpen, setAddOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function change(challengeId: number, remove = false) {
    setBusy(true);
    setError(null);
    try {
      if (remove) await removeWorkGroupChallenge(group.id, challengeId, crypto.randomUUID());
      else await addWorkGroupChallenge(group.id, challengeId, crypto.randomUUID());
      setSelected("");
      if (!remove) setAddOpen(false);
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
      title={t("challenges")}
      headerClassName={PAIRED_HEADER_CLASS}
      action={
        editable && available.length ? (
          <SidePanelEditor
            open={addOpen}
            onOpenChange={setAddOpen}
            trigger={
              <Button size="sm" variant="outline">
                {t("addChallenge")}
              </Button>
            }
            title={t("addChallenge")}
            footer={
              <Button
                disabled={busy || !selected}
                onClick={() => change(Number(selected))}
                loading={busy}
              >
                {t("addChallenge")}
              </Button>
            }
          >
            <div className="space-y-2">
              <label className="type-label" htmlFor="group-challenge">
                {t("challenges")}
              </label>
              <EntityCombobox
                inDialog
                id="group-challenge"
                options={available}
                getId={(challenge) => challenge.id}
                getLabel={(challenge) => challengeTitleText(challenge.title)}
                value={selected}
                placeholder={t("selectChallengePlaceholder")}
                onChange={setSelected}
                disabled={busy}
              />
              {error && <ContextualError message={error} />}
            </div>
          </SidePanelEditor>
        ) : undefined
      }
    >
      {group.challenges.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("noChallenges")}</p>
      )}
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
                loading={busy}
              >
                {t("remove")}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      <dl className="flex flex-wrap justify-between gap-2 border-t border-border pt-4 text-sm">
        <dt className="text-muted-foreground">{t("workGroupTiming")}</dt>
        <dd className="font-medium">
          {t(
            group.presentation_timing_preference === "early"
              ? "workGroupTimingEarly"
              : group.presentation_timing_preference === "middle"
                ? "workGroupTimingMiddle"
                : group.presentation_timing_preference === "late"
                  ? "workGroupTimingLate"
                  : "workGroupTimingNone",
          )}
        </dd>
      </dl>
      {error && !addOpen && <ContextualError message={error} />}
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
