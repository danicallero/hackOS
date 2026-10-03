"use client";
import { EVENTS } from "@hackos/shared/events";
import { FolderSimpleIcon } from "@phosphor-icons/react/dist/csr/FolderSimple";
import { UserPlusIcon } from "@phosphor-icons/react/dist/csr/UserPlus";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ContextualError } from "@/components/common/contextual-error";
import { EmptyState } from "@/components/common/empty-state";
import { EntityCombobox } from "@/components/common/entity-combobox";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { SidePanelEditor } from "@/components/common/side-panel-editor";
import { Spinner } from "@/components/common/spinner";
import { PresentationStatus } from "@/components/projects/presentation-status";
import { ProjectDescriptionLinks } from "@/components/projects/project-description-links";
import { ProjectNavigation } from "@/components/projects/project-navigation";
import { WorkGroupEditor } from "@/components/projects/work-group-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import {
  addMyProjectChallenge,
  inviteProjectMember,
  myProjects,
  myWorkGroups,
  type PlannedWorkGroup,
  removeMyProjectChallenge,
} from "@/lib/projects";
import { showErrorToast, toast } from "@/lib/toast";
import { ProjectFormDialog } from "../../../projects/project-form-dialog";
import {
  type ChallengeOption,
  challengeTitleText,
  memberName,
  type ProjectRepo,
  toProjectRepo,
} from "../../../projects/shared";

export default function MyProjectDetailPage() {
  const { t } = useLocale();
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<ProjectRepo | null>(null);
  const [group, setGroup] = useState<PlannedWorkGroup | null>(null);
  const [challenges, setChallenges] = useState<ChallengeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [changeError, setChangeError] = useState<string | null>(null);
  const [removingChallenge, setRemovingChallenge] = useState<number | null>(null);
  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [result, catalogue, planned] = await Promise.all([
        myProjects(),
        api.get<{ items: ChallengeOption[] }>("/api/public/challenges"),
        myWorkGroups(),
      ]);
      setProject(result.projects.map(toProjectRepo).find((item) => item.id === Number(id)) ?? null);
      setChallenges(catalogue.items);
      setGroup(planned.groups.find((item) => item.linked_repo_id === Number(id)) ?? null);
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : t("couldNotLoadProject"),
        t("projectLabel"),
      );
      setLoadError(error instanceof ApiError ? error.message : t("couldNotLoadProject"));
    } finally {
      setLoading(false);
    }
  }, [id, t]);
  const liveRefresh = useAutoRefresh("/api/events/stream?topic=projects", [EVENTS.DOMAIN_CHANGED]);
  const queueRefresh = useAutoRefresh("/api/queue/me/stream", [
    EVENTS.USER_QUEUE_CHANGED,
    EVENTS.USER_QUEUE_CALLED,
  ]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh nonces trigger authoritative refetches (H38).
  useEffect(() => {
    void load();
  }, [load, liveRefresh, queueRefresh]);
  if (loading)
    return (
      <div className="flex min-h-80 items-center justify-center">
        <Spinner />
      </div>
    );
  if (loadError) return <ContextualError message={loadError} onRetry={load} />;
  if (!project) return <EmptyState icon={FolderSimpleIcon} title={t("projectNotFoundTitle")} />;
  return (
    <div className="space-y-6">
      <PageHeader
        title={project.name}
        meta={
          project.presentation_timing_preference && (
            <span className="text-sm text-muted-foreground">
              {t("workGroupTiming")}:{" "}
              {project.presentation_timing_preference === "early"
                ? t("workGroupTimingEarly")
                : project.presentation_timing_preference === "middle"
                  ? t("workGroupTimingMiddle")
                  : project.presentation_timing_preference === "late"
                    ? t("workGroupTimingLate")
                    : t("workGroupTimingNone")}
            </span>
          )
        }
        secondaryActions={<ProjectNavigation />}
        primaryAction={
          group ? (
            <WorkGroupEditor
              key={JSON.stringify([
                project.name,
                group.presentation_timing_preference,
                project.description,
                project.github_url,
                project.demo_url,
              ])}
              group={{
                ...group,
                name: project.name,
                description: project.description ?? "",
                github_url: project.github_url,
                demo_url: project.demo_url,
                devpost_url: project.devpost_url,
              }}
              onSaved={load}
            />
          ) : (
            <ProjectFormDialog mode={{ kind: "self-edit", repo: project }} onSaved={load} />
          )
        }
      />
      <ProjectDescriptionLinks
        description={project.description}
        links={{
          devpostUrl: project.devpost_url,
          demoUrl: project.demo_url,
          githubUrl: project.github_url,
        }}
      />
      <div className="grid gap-8 xl:grid-cols-3 xl:gap-12">
        <SectionCard
          variant="plain"
          title={t("teamSectionTitle")}
          action={<InviteMember projectId={project.id} onInvited={load} />}
        >
          <ul className="divide-y divide-border/60">
            {project.members.map((member, index) => (
              <li
                className="py-2 text-sm font-medium"
                key={`${member.userId ?? "devpost"}:${member.email ?? index}`}
              >
                {memberName(member) || t("unnamedTeamMember")}
              </li>
            ))}
          </ul>
        </SectionCard>
        <SectionCard
          variant="plain"
          className="xl:col-span-2"
          title={t("challenges")}
          action={<AddChallenge project={project} challenges={challenges} onAdded={load} />}
        >
          <ul className="divide-y divide-border/60">
            {project.challenges.map((challenge) => (
              <li
                className="flex items-start justify-between gap-4 py-4 first:pt-0 last:pb-0"
                key={challenge.id}
              >
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <h3 className="text-base font-medium text-balance">
                      {challengeTitleText(challenge.title)}
                    </h3>
                    {challenge.mandatory && (
                      <span className="text-xs text-muted-foreground">
                        {t("mandatoryChallengeLabel")}
                      </span>
                    )}
                  </div>
                  {challenge.status ? (
                    <PresentationStatus {...challenge} />
                  ) : (
                    <p className="text-sm text-muted-foreground">{t("plannedChallenge")}</p>
                  )}
                </div>
                {challenge.mandatory ? null : (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={removingChallenge !== null}
                    onClick={async () => {
                      setRemovingChallenge(challenge.id);
                      setChangeError(null);
                      try {
                        await removeMyProjectChallenge(
                          project.id,
                          challenge.id,
                          crypto.randomUUID(),
                        );
                        await load();
                      } catch (error) {
                        setChangeError(
                          error instanceof ApiError ? error.message : t("couldNotRemoveChallenge"),
                        );
                      } finally {
                        setRemovingChallenge(null);
                      }
                    }}
                  >
                    {t("remove")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {changeError && <ContextualError message={changeError} />}
        </SectionCard>
      </div>
    </div>
  );
}

function AddChallenge({
  project,
  challenges,
  onAdded,
}: {
  project: ProjectRepo;
  challenges: ChallengeOption[];
  onAdded: () => Promise<void>;
}) {
  const { t } = useLocale();
  const [selected, setSelected] = useState("");
  const [saving, setSaving] = useState(false);
  const available = challenges.filter(
    (challenge) => !project.challenges.some((item) => item.id === challenge.id),
  );
  if (available.length === 0) return null;
  async function add() {
    setSaving(true);
    try {
      await addMyProjectChallenge(project.id, Number(selected), crypto.randomUUID());
      setSelected("");
      await onAdded();
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : t("couldNotSaveProject"),
        t("addChallengeLabel"),
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <SidePanelEditor
      trigger={
        <Button size="sm" variant="outline">
          {t("addChallenge")}
        </Button>
      }
      title={t("addChallenge")}
      footer={
        <Button disabled={saving || !selected} onClick={add}>
          {t("addChallenge")}
        </Button>
      }
    >
      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="project-challenge">
          {t("challenges")}
        </label>
        <EntityCombobox
          inDialog
          id="project-challenge"
          options={available}
          getId={(challenge) => challenge.id}
          getLabel={(challenge) => challengeTitleText(challenge.title)}
          onChange={setSelected}
          value={selected}
          disabled={saving}
          placeholder={t("selectChallengePlaceholder")}
        />
      </div>
    </SidePanelEditor>
  );
}

function InviteMember({
  projectId,
  onInvited,
}: {
  projectId: number;
  onInvited: () => Promise<void>;
}) {
  const { t } = useLocale();
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  async function invite() {
    setSaving(true);
    try {
      await inviteProjectMember(projectId, email.trim(), crypto.randomUUID());
      setEmail("");
      await onInvited();
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
      setSaving(false);
    }
  }
  return (
    <SidePanelEditor
      trigger={
        <Button size="sm" variant="outline">
          <UserPlusIcon aria-hidden="true" className="size-4" />
          {t("inviteMemberCta")}
        </Button>
      }
      title={t("inviteMemberTitle")}
      footer={
        <Button disabled={saving || !email.trim()} onClick={invite}>
          {t("inviteMemberCta")}
        </Button>
      }
    >
      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="invite-email">
          {t("inviteEmailLabel")}
        </label>
        <Input
          id="invite-email"
          onChange={(event) => setEmail(event.target.value)}
          type="email"
          value={email}
        />
      </div>
    </SidePanelEditor>
  );
}
