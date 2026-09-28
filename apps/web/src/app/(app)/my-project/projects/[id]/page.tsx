"use client";

import { FolderGitIcon, TrophyIcon, UserPlusIcon, UsersIcon } from "lucide-react";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { QueueStatusBadge } from "@/components/common/queue-status-badge";
import { SectionCard } from "@/components/common/section-card";
import { SidePanelEditor } from "@/components/common/side-panel-editor";
import { Spinner } from "@/components/common/spinner";
import { StatusBadge } from "@/components/common/status-badge";
import { ProjectDescriptionLinks } from "@/components/projects/project-description-links";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { addMyProjectChallenge, inviteProjectMember, myProjects } from "@/lib/projects";
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
  const [challenges, setChallenges] = useState<ChallengeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    try {
      const [result, catalogue] = await Promise.all([
        myProjects(),
        api.get<{ items: ChallengeOption[] }>("/api/public/challenges"),
      ]);
      setProject(result.projects.map(toProjectRepo).find((item) => item.id === Number(id)) ?? null);
      setChallenges(catalogue.items);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("couldNotLoadProject"));
    } finally {
      setLoading(false);
    }
  }, [id, t]);
  useEffect(() => {
    void load();
  }, [load]);
  if (loading)
    return (
      <div className="flex min-h-80 items-center justify-center">
        <Spinner />
      </div>
    );
  if (!project) return <EmptyState icon={FolderGitIcon} title={t("projectNotFoundTitle")} />;
  return (
    <div className="space-y-6">
      <PageHeader
        title={project.name}
        state={
          project.presentation_timing_preference && (
            <StatusBadge tone="neutral">
              {project.presentation_timing_preference === "early"
                ? t("workGroupTimingEarly")
                : project.presentation_timing_preference === "middle"
                  ? t("workGroupTimingMiddle")
                  : project.presentation_timing_preference === "late"
                    ? t("workGroupTimingLate")
                    : t("workGroupTimingNone")}
            </StatusBadge>
          )
        }
        actions={<ProjectFormDialog mode={{ kind: "self-edit", repo: project }} onSaved={load} />}
      />
      <ProjectDescriptionLinks
        description={project.description}
        links={{
          devpostUrl: project.devpost_url,
          demoUrl: project.demo_url,
          githubUrl: project.github_url,
        }}
      />
      <div className="grid gap-5 xl:grid-cols-2">
        <SectionCard
          title={t("teamSectionTitle")}
          icon={UsersIcon}
          action={<InviteMember projectId={project.id} onInvited={load} />}
        >
          <ul className="space-y-3">
            {project.members.map((member, index) => (
              <li
                className="rounded-md border p-3 font-medium"
                key={`${member.userId ?? "devpost"}:${member.email ?? index}`}
              >
                {memberName(member) || t("unnamedTeamMember")}
              </li>
            ))}
          </ul>
        </SectionCard>
        <SectionCard
          title={t("challenges")}
          icon={TrophyIcon}
          action={<AddChallenge project={project} challenges={challenges} onAdded={load} />}
        >
          <ul className="space-y-3">
            {project.challenges.map((challenge) => (
              <li
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
                key={challenge.id}
              >
                <span className="font-medium">{challengeTitleText(challenge.title)}</span>
                {challenge.status ? (
                  <QueueStatusBadge status={challenge.status} />
                ) : (
                  <StatusBadge tone="neutral">{t("plannedChallenge")}</StatusBadge>
                )}
              </li>
            ))}
          </ul>
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
      toast.error(error instanceof ApiError ? error.message : t("couldNotSaveProject"));
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
        <select
          className="h-9 w-full rounded-md border bg-background px-3 text-sm"
          id="project-challenge"
          onChange={(event) => setSelected(event.target.value)}
          value={selected}
        >
          <option value="">{t("selectChallengePlaceholder")}</option>
          {available.map((challenge) => (
            <option key={challenge.id} value={challenge.id}>
              {challengeTitleText(challenge.title)}
            </option>
          ))}
        </select>
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
          description: t("inviteAcceptedParticipantRequired"),
        });
      } else {
        toast.error(error instanceof ApiError ? error.message : t("couldNotSendInvite"));
      }
    } finally {
      setSaving(false);
    }
  }
  return (
    <SidePanelEditor
      trigger={
        <Button size="sm" variant="outline">
          <UserPlusIcon className="size-4" />
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
