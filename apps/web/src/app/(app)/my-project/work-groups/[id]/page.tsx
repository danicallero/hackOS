"use client";

import {
  FolderGitIcon,
  LinkIcon,
  PencilIcon,
  TrophyIcon,
  UserPlusIcon,
  UsersIcon,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AlertModal } from "@/components/common/alert-modal";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { SidePanelEditor } from "@/components/common/side-panel-editor";
import { Spinner } from "@/components/common/spinner";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import {
  addWorkGroupChallenge,
  deleteWorkGroup,
  getMyWorkGroup,
  inviteWorkGroupMember,
  type PlannedWorkGroup,
  removeWorkGroupChallenge,
  removeWorkGroupMember,
  updateWorkGroup,
} from "@/lib/projects";
import { useMe } from "@/lib/session";
import { showErrorToast, toast } from "@/lib/toast";
import { type ChallengeOption, challengeTitleText } from "../../../projects/shared";

export default function WorkGroupDetailPage() {
  const { t } = useLocale();
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const [group, setGroup] = useState<PlannedWorkGroup | null>(null);
  const [challenges, setChallenges] = useState<ChallengeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    try {
      const [next, catalogue] = await Promise.all([
        getMyWorkGroup(id),
        api.get<{ items: ChallengeOption[] }>("/api/public/challenges"),
      ]);
      setGroup(next);
      setChallenges(catalogue.items);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("couldNotLoadProject"));
      setGroup(null);
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
  if (!group) return <EmptyState icon={FolderGitIcon} title={t("projectNotFoundTitle")} />;
  return (
    <div className="space-y-6">
      <PageHeader
        title={group.name}
        state={
          <StatusBadge tone={group.linked_repo_id ? "success" : "info"}>
            {group.linked_repo_id ? t("workGroupLinked") : t("workGroupPlanned")}
          </StatusBadge>
        }
        actions={<WorkGroupEditor group={group} onSaved={load} />}
      />
      {group.description && (
        <p className="max-w-prose whitespace-pre-wrap text-sm">{group.description}</p>
      )}
      {group.linkedProject && (
        <SectionCard title={t("workGroupLinkedProject")} icon={LinkIcon}>
          <Link className="font-medium underline" href={`/projects/${group.linkedProject.id}`}>
            {group.linkedProject.name}
          </Link>
        </SectionCard>
      )}
      <div className="grid gap-5 xl:grid-cols-2">
        <Members group={group} onChanged={load} />
        <Challenges group={group} challenges={challenges} onChanged={load} />
      </div>
      <DeleteGroup
        group={group}
        onDeleted={() => {
          window.location.assign("/my-project");
        }}
      />
    </div>
  );
}

function WorkGroupEditor({
  group,
  onSaved,
}: {
  group: PlannedWorkGroup;
  onSaved: () => Promise<void>;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description ?? "");
  const [github, setGithub] = useState(group.github_url ?? "");
  const [demo, setDemo] = useState(group.demo_url ?? "");
  const [devpost, setDevpost] = useState(group.devpost_url ?? "");
  const [timing, setTiming] = useState(group.presentation_timing_preference);
  async function save() {
    setPending(true);
    try {
      await updateWorkGroup(group.id, {
        name: name.trim(),
        description: description.trim(),
        github_url: github.trim() || null,
        demo_url: demo.trim() || null,
        devpost_url: devpost.trim() || null,
        presentation_timing_preference: timing,
      });
      toast.success(t("projectSaved"));
      setOpen(false);
      await onSaved();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("couldNotSaveProject"));
    } finally {
      setPending(false);
    }
  }
  return (
    <SidePanelEditor
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="outline">
          <PencilIcon className="size-4" />
          {t("editProject")}
        </Button>
      }
      icon={PencilIcon}
      title={t("editProject")}
      footer={
        <Button disabled={pending || !name.trim()} onClick={save}>
          {t("save")}
        </Button>
      }
    >
      <div className="space-y-4">
        <Field id="group-name" label={t("workGroupName")} value={name} onChange={setName} />
        <div className="space-y-2">
          <Label htmlFor="group-description">{t("descriptionLabel")}</Label>
          <Textarea
            id="group-description"
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <Field
          id="group-devpost"
          label={t("workGroupDevpostUrl")}
          value={devpost}
          onChange={setDevpost}
          type="url"
        />
        <Field
          id="group-github"
          label={t("projectRepoUrlLabel")}
          value={github}
          onChange={setGithub}
          type="url"
        />
        <Field
          id="group-demo"
          label={t("projectDemoUrlLabel")}
          value={demo}
          onChange={setDemo}
          type="url"
        />
        <div className="space-y-2">
          <Label htmlFor="group-timing">{t("workGroupTiming")}</Label>
          <select
            id="group-timing"
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
            value={timing}
            disabled={!group.presentation_timing_editable}
            onChange={(e) => setTiming(e.target.value as typeof timing)}
          >
            <option value="no_preference" aria-label={t("workGroupTimingNone")} />
            <option value="early">{t("workGroupTimingEarly")}</option>
            <option value="middle">{t("workGroupTimingMiddle")}</option>
            <option value="late">{t("workGroupTimingLate")}</option>
          </select>
        </div>
      </div>
    </SidePanelEditor>
  );
}
function Field({
  id,
  label,
  value,
  onChange,
  type = "text",
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type={type} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
function Members({
  group,
  onChanged,
}: {
  group: PlannedWorkGroup;
  onChanged: () => Promise<void>;
}) {
  const { t } = useLocale();
  const me = useMe();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
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
      title={t("teamSectionTitle")}
      icon={UsersIcon}
      action={
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
      }
    >
      <ul className="space-y-3">
        {group.members.map((member) => (
          <li
            className="flex items-center justify-between gap-3 rounded-md border p-3"
            key={member.userId}
          >
            <span className="font-medium">
              {[member.name, member.surname].filter(Boolean).join(" ") || t("unnamedTeamMember")}
            </span>
            <div className="flex items-center gap-2">
              <StatusBadge tone={member.status === "active" ? "success" : "neutral"}>
                {member.status}
              </StatusBadge>
              {member.userId !== me?.id && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    await removeWorkGroupMember(group.id, member.userId, crypto.randomUUID());
                    await onChanged();
                  }}
                >
                  {t("remove")}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
function Challenges({
  group,
  challenges,
  onChanged,
}: {
  group: PlannedWorkGroup;
  challenges: ChallengeOption[];
  onChanged: () => Promise<void>;
}) {
  const { t } = useLocale();
  const [selected, setSelected] = useState("");
  const available = challenges.filter(
    (challenge) => !group.challenges.some((item) => item.id === challenge.id),
  );
  return (
    <SectionCard
      title={t("challenges")}
      icon={TrophyIcon}
      footer={
        available.length ? (
          <div className="flex gap-2">
            <select
              className="h-9 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              <option value="">{t("selectChallengePlaceholder")}</option>
              {available.map((challenge) => (
                <option key={challenge.id} value={challenge.id}>
                  {challengeTitleText(challenge.title)}
                </option>
              ))}
            </select>
            <Button
              disabled={!selected}
              onClick={async () => {
                await addWorkGroupChallenge(group.id, Number(selected), crypto.randomUUID());
                setSelected("");
                await onChanged();
              }}
            >
              {t("addAction")}
            </Button>
          </div>
        ) : undefined
      }
    >
      <ul className="space-y-3">
        {group.challenges.map((challenge) => (
          <li
            key={challenge.id}
            className="flex items-center justify-between gap-3 rounded-md border p-3"
          >
            <span className="font-medium">{challengeTitleText(challenge.title)}</span>
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                await removeWorkGroupChallenge(group.id, challenge.id, crypto.randomUUID());
                await onChanged();
              }}
            >
              {t("remove")}
            </Button>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
function DeleteGroup({ group, onDeleted }: { group: PlannedWorkGroup; onDeleted: () => void }) {
  const { t } = useLocale();
  const [pending, setPending] = useState(false);
  return (
    <AlertModal
      title={t("deleteWorkGroupTitle")}
      description={t("deleteWorkGroupDesc")}
      cancelLabel={t("cancel")}
      confirmLabel={t("deleteWorkGroupCta")}
      destructive
      pending={pending}
      trigger={<Button variant="outline">{t("deleteWorkGroupCta")}</Button>}
      onConfirm={async () => {
        setPending(true);
        try {
          await deleteWorkGroup(group.id, crypto.randomUUID());
          onDeleted();
        } finally {
          setPending(false);
        }
      }}
    />
  );
}
