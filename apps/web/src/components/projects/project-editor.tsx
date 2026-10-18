"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useProjectDraft } from "@/app/(app)/my-project/[id]/use-project-draft";
import { AlertModal } from "@/components/common/alert-modal";
import { ContextualError } from "@/components/common/contextual-error";
import { LinkifiedText } from "@/components/common/linkified-text";
import { PageLayout } from "@/components/common/page-layout";
import { SaveStatus } from "@/components/common/save-status";
import { SectionCard } from "@/components/common/section-card";
import { ProjectsSectionHeader } from "@/components/common/section-navigation";
import { StatusBadge } from "@/components/common/status-badge";
import {
  type FieldValue,
  TemplateFieldControl,
  templateFieldId,
} from "@/components/common/template-field-control";
import { UserAvatar } from "@/components/common/user-avatar";
import { type UserOption, UserPicker } from "@/components/common/user-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import { groupApplicationFields } from "@/lib/application-field-groups";
import { validateFieldOnBlur } from "@/lib/application-validation";
import { API_URL } from "@/lib/env";
import { pickText, useLocale } from "@/lib/i18n";
import { invalidateProjectReads, type NativeProject, nativeProjects } from "@/lib/native-projects";
import { useSessionContext } from "@/lib/session";
import { useUnsavedChangesGuard } from "@/lib/use-unsaved-changes-guard";
import { GithubActivity } from "./github-activity";
import { GithubLink } from "./github-link";
import { ProjectChallenges } from "./project-challenges";
import { ProjectOverview } from "./project-overview";
import { ProjectVideo } from "./project-video";

export function ProjectEditor({
  project: initialProject,
  staff = false,
}: {
  project: NativeProject;
  staff?: boolean;
}) {
  const { t, language } = useLocale();
  const { can } = useSessionContext();
  const [project, setProject] = useState(initialProject);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const [editing, setEditing] = useState(
    project.canEdit &&
      (searchParams.get("edit") === "1" ||
        (!staff &&
          Object.values(project.responses).every(
            (value) =>
              value == null || value === "" || (Array.isArray(value) && value.length === 0),
          ))),
  );
  const [selectedUser, setSelectedUser] = useState("");
  const [removeUser, setRemoveUser] = useState<number | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const draft = useProjectDraft(project, t, staff);
  const [name, setName] = useState(project.name);
  const [savedName, setSavedName] = useState(project.name);
  useUnsavedChangesGuard(draft.state !== "saved" || name.trim() !== savedName);
  const [timing, setTiming] = useState(project.presentationTimingPreference);
  const [status, setStatus] = useState(project.submissionStatus);
  const [email, setEmail] = useState("");
  const [members, setMembers] = useState(project.members);
  const [challenges, setChallenges] = useState(project.challenges);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  async function submit() {
    const errors: Record<string, string> = {};
    for (const field of project.template) {
      const message = validateFieldOnBlur(field, draft.values[field.key], t, language);
      if (message) errors[field.key] = message;
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length) {
      document.getElementById(templateFieldId(Object.keys(errors)[0]))?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (!(await draft.save())) return;
      await nativeProjects.submit(project.id);
      await reloadAfterTransition(false);
    } catch (cause) {
      setError(apiErrorText(cause, t, t("couldNotSaveDraft")));
    } finally {
      setBusy(false);
    }
  }
  /** Submission flags (edit, withdraw) flip server-side, so the working copy is read again. */
  async function reloadAfterTransition(nextEditing: boolean) {
    invalidateProjectReads(project.id);
    const fresh = await api.get<NativeProject>(`/api/me/projects/${project.id}`);
    setProject(fresh);
    setStatus(fresh.submissionStatus);
    setEditing(nextEditing);
  }
  async function withdraw() {
    setBusy(true);
    setError(null);
    try {
      await nativeProjects.withdrawSubmission(project.id);
      await reloadAfterTransition(true);
      setWithdrawOpen(false);
    } catch (cause) {
      setError(apiErrorText(cause, t, t("couldNotSaveDraft")));
      setWithdrawOpen(false);
    } finally {
      setBusy(false);
    }
  }
  async function invite(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await nativeProjects.invite(project.id, email.trim());
      setEmail("");
      invalidateProjectReads(project.id);
      setMembers((await nativeProjects.get(project.id)).members);
    } catch (cause) {
      setError(apiErrorText(cause, t, t("couldNotLoadProject")));
    } finally {
      setBusy(false);
    }
  }
  async function saveName() {
    if (!project.canEdit || busy) return;
    const next = name.trim();
    if (!next) {
      // A blank name is never sent; restore the saved one so the guard does not block navigation.
      setName(savedName);
      setNameError(null);
      return;
    }
    if (next === savedName) {
      setName(next);
      return;
    }
    setBusy(true);
    setNameError(null);
    try {
      if (staff) await api.patch(`/api/repos/${project.id}`, { name: next });
      else await nativeProjects.update(project.id, { name: next });
      invalidateProjectReads(project.id);
      setSavedName(next);
      setName(next);
    } catch (cause) {
      // The edit stays dirty (guarded) so it is not silently lost; blurring again retries.
      setNameError(apiErrorText(cause, t, t("couldNotSaveProject")));
    } finally {
      setBusy(false);
    }
  }
  async function saveTiming(value: NativeProject["presentationTimingPreference"]) {
    setBusy(true);
    setError(null);
    try {
      if (staff)
        await api.patch(`/api/repos/${project.id}`, { presentationTimingPreference: value });
      else await nativeProjects.update(project.id, { presentationTimingPreference: value });
      invalidateProjectReads(project.id);
      setTiming(value);
    } catch (cause) {
      setError(apiErrorText(cause, t, t("couldNotSaveProject")));
    } finally {
      setBusy(false);
    }
  }
  async function changeMember(removeId?: number) {
    setBusy(true);
    setError(null);
    try {
      if (removeId !== undefined) await api.delete(`/api/repos/${project.id}/members/${removeId}`);
      else await api.post(`/api/repos/${project.id}/members`, { userId: Number(selectedUser) });
      invalidateProjectReads(project.id);
      setMembers((await api.get<NativeProject>(`/api/repos/${project.id}`)).members);
      setSelectedUser("");
      setRemoveUser(null);
    } catch (cause) {
      setError(apiErrorText(cause, t, t("couldNotSaveProject")));
    } finally {
      setBusy(false);
    }
  }
  async function leave() {
    setBusy(true);
    setError(null);
    try {
      await api.delete(`/api/me/projects/${project.id}/leave`);
      invalidateProjectReads(project.id);
      router.push("/my-project?view=all");
    } catch (cause) {
      setError(apiErrorText(cause, t, t("couldNotLeaveProject")));
      setBusy(false);
    }
  }
  const incomplete = project.template.filter((field) =>
    validateFieldOnBlur(field, draft.values[field.key], t, language),
  );
  const editAction = project.canEdit ? (
    <Button
      variant={editing ? "outline" : "default"}
      disabled={busy || draft.state === "saving"}
      onClick={async () => {
        if (editing && !(await draft.save())) return;
        setEditing((value) => !value);
      }}
    >
      {t(editing ? "viewProject" : "editProjectDetails")}
    </Button>
  ) : project.canWithdraw ? (
    <Button variant="outline" disabled={busy} onClick={() => setWithdrawOpen(true)}>
      {t("projectWithdrawCta")}
    </Button>
  ) : undefined;
  return (
    <PageLayout>
      <AlertModal
        open={withdrawOpen}
        onOpenChange={setWithdrawOpen}
        title={t("projectWithdrawTitle")}
        description={t("projectWithdrawDesc")}
        cancelLabel={t("cancel")}
        confirmLabel={t("projectWithdrawCta")}
        pending={busy}
        onConfirm={() => void withdraw()}
      />
      <AlertModal
        open={leaveOpen}
        onOpenChange={setLeaveOpen}
        title={t("leaveProjectTitle")}
        description={t("leaveProjectDesc")}
        cancelLabel={t("cancel")}
        confirmLabel={t("leaveProjectCta")}
        pending={busy}
        onConfirm={() => void leave()}
      />
      <AlertModal
        open={removeUser !== null}
        onOpenChange={(open) => !open && setRemoveUser(null)}
        title={t("toastRemoveMember")}
        description={t("leaveProjectDesc")}
        cancelLabel={t("cancel")}
        confirmLabel={t("remove")}
        destructive
        pending={busy}
        onConfirm={() => void changeMember(removeUser!)}
      />
      <ProjectsSectionHeader
        management={staff}
        recordName={name || project.name}
        recordAction={editAction}
        recordState={
          <StatusBadge tone={status === "submitted" ? "success" : "neutral"} dot={false}>
            {t(status === "submitted" ? "dataStatusSubmitted" : "dataStatusDraft")}
          </StatusBadge>
        }
      />
      {editing ? (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="space-y-6">
            <SectionCard
              title={project.sections.length ? undefined : t("projectDetailsTitle")}
              stickyFooter
              footer={
                <>
                  <SaveStatus
                    state={draft.state}
                    showIcon={draft.state !== "saving"}
                    className="mr-auto"
                  />
                  <Button
                    variant="outline"
                    disabled={!project.canEdit || busy || draft.state === "saving"}
                    onClick={() => void draft.save()}
                  >
                    {t("saveDraft")}
                  </Button>
                  {!staff && (
                    <Button
                      loading={busy}
                      disabled={
                        !(project.canSubmit ?? project.canEdit) || busy || draft.state === "saving"
                      }
                      onClick={() => void submit()}
                    >
                      {t("projectSubmitCta")}
                    </Button>
                  )}
                </>
              }
            >
              {draft.error && (
                <ContextualError message={draft.error} onRetry={() => void draft.save()} />
              )}
              {error && <ContextualError message={error} />}
              <div className="space-y-8">
                {project.canEdit && (
                  <div className="space-y-2">
                    <Label htmlFor="project-edit-name">{t("projectNameLabel")}</Label>
                    <Input
                      id="project-edit-name"
                      value={name}
                      disabled={busy}
                      aria-invalid={nameError ? true : undefined}
                      onChange={(event) => {
                        setName(event.target.value);
                        setNameError(null);
                      }}
                      onBlur={() => void saveName()}
                    />
                    {nameError && (
                      <ContextualError message={nameError} onRetry={() => void saveName()} />
                    )}
                  </div>
                )}
                {groupApplicationFields(project.template, project.sections).map((group, index) => (
                  <section
                    className="space-y-5 border-t border-border/60 pt-6 first:border-0 first:pt-0"
                    key={group.section?.key ?? index}
                  >
                    {group.section && (
                      <h2 className="type-section-title text-balance">
                        {pickText(group.section.title, language)}
                      </h2>
                    )}
                    {group.section?.description &&
                      pickText(group.section.description, language) && (
                        <LinkifiedText
                          text={pickText(group.section.description, language)}
                          className="block text-sm text-muted-foreground"
                        />
                      )}
                    {group.fields.map((field) => (
                      <div key={field.key} className="space-y-3">
                        <TemplateFieldControl
                          key={field.key}
                          field={field}
                          value={draft.values[field.key] as FieldValue}
                          onChange={(value) => {
                            draft.change(field.key, value);
                            setFieldErrors((previous) => {
                              const next = { ...previous };
                              delete next[field.key];
                              return next;
                            });
                          }}
                          onBlur={(value) => {
                            const message = validateFieldOnBlur(field, value, t, language);
                            setFieldErrors((previous) => {
                              const next = { ...previous };
                              if (message) next[field.key] = message;
                              else delete next[field.key];
                              return next;
                            });
                          }}
                          disabled={!project.canEdit || busy}
                          lang={language}
                          error={fieldErrors[field.key]}
                          downloadUrl={
                            project.files?.find((file) => file.fieldKey === field.key)?.url
                              ? new URL(
                                  project.files.find((file) => file.fieldKey === field.key)!.url,
                                  API_URL,
                                ).toString()
                              : undefined
                          }
                          uploadPath={`/api/me/projects/${project.id}/uploads?fieldKey=${encodeURIComponent(field.key)}`}
                          files={project.files}
                        />
                        {field.project_video && (
                          <ProjectVideo
                            value={draft.values[field.key]}
                            title={pickText(field.label, language)}
                          />
                        )}
                      </div>
                    ))}
                  </section>
                ))}
              </div>
            </SectionCard>
          </div>
          <div className="min-w-0 space-y-6">
            <SectionCard
              title={t("surfaceTeam")}
              action={
                !staff &&
                editing && (
                  <Button variant="outline" disabled={busy} onClick={() => setLeaveOpen(true)}>
                    {t("leaveProjectCta")}
                  </Button>
                )
              }
            >
              <ul className="divide-y divide-border/60">
                {members
                  .filter((member) => member.status !== "declined")
                  .map((member) => (
                    <li className="flex items-center gap-3 py-3" key={member.userId}>
                      {member.photoUrl && (
                        <UserAvatar
                          name={member.name ?? ""}
                          image={member.photoUrl}
                          className="size-8"
                          decorative
                        />
                      )}
                      <span className="mr-auto">{member.name}</span>
                      {staff && project.canEdit && editing && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={() => setRemoveUser(member.userId)}
                        >
                          {t("remove")}
                        </Button>
                      )}
                      {member.status === "invited" && (
                        <span className="text-muted-foreground text-sm">
                          {t("pendingInvitesTitle")}
                        </span>
                      )}
                    </li>
                  ))}
              </ul>
              {staff && project.canEdit && editing && (
                <div className="mt-4 space-y-2">
                  <Label htmlFor="staff-project-member">{t("addMemberLabel")}</Label>
                  <UserPicker
                    id="staff-project-member"
                    value={selectedUser}
                    onChange={setSelectedUser}
                    minQueryLength={2}
                    search={async (q) =>
                      (
                        await api.get<{ users: UserOption[] }>("/api/projects/member-candidates", {
                          query: { q },
                        })
                      ).users
                    }
                    disabled={busy}
                  />
                  <Button
                    variant="outline"
                    disabled={busy || !selectedUser}
                    onClick={() => void changeMember()}
                  >
                    {t("addMemberLabel")}
                  </Button>
                </div>
              )}
              {!staff && editing && (project.canInvite ?? project.canEdit) && (
                <form className="mt-4 space-y-2" onSubmit={invite}>
                  <Label htmlFor="invite-email">{t("email")}</Label>
                  <div className="flex flex-wrap gap-2">
                    <Input
                      id="invite-email"
                      className="min-w-0 flex-1 basis-40"
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      required
                      disabled={busy}
                    />
                    <Button type="submit" variant="outline" disabled={busy}>
                      {t("inviteMemberCta")}
                    </Button>
                  </div>
                </form>
              )}
            </SectionCard>
            {!staff && project.isMember && <GithubLink projectId={project.id} />}
            <ProjectChallenges
              project={{ ...project, challenges, canEdit: project.canEdit && editing }}
              onChange={setChallenges}
              staff={staff}
            >
              {editing && (
                <div className="space-y-2">
                  <Label htmlFor="project-timing">{t("workGroupTiming")}</Label>
                  <Select
                    value={timing}
                    onValueChange={(value) =>
                      void saveTiming(value as NativeProject["presentationTimingPreference"])
                    }
                    disabled={busy || !project.canEdit}
                  >
                    <SelectTrigger id="project-timing" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="no_preference">{t("workGroupTimingNone")}</SelectItem>
                      <SelectItem value="early">{t("workGroupTimingEarly")}</SelectItem>
                      <SelectItem value="middle">{t("workGroupTimingMiddle")}</SelectItem>
                      <SelectItem value="late">{t("workGroupTimingLate")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </ProjectChallenges>
          </div>
        </div>
      ) : (
        <ProjectOverview
          showQueue
          asideExtra={
            !staff && project.isMember ? (
              <GithubLink projectId={project.id} variant="plain" />
            ) : staff && can(CAPABILITIES.PROJECTS_READ) ? (
              <GithubActivity projectId={project.id} />
            ) : undefined
          }
          review={
            staff && (incomplete.length > 0 || status === "draft") ? (
              <SectionCard title={t("projectReviewTitle")} variant="plain">
                {status === "draft" && (
                  <p className="mb-3 text-sm text-muted-foreground">{t("projectIneligible")}</p>
                )}
                <ul className="space-y-2">
                  {incomplete.map((field) => (
                    <li key={field.key} className="flex flex-wrap justify-between gap-2 text-sm">
                      <span>{pickText(field.label, language)}</span>
                      <span className="text-muted-foreground">
                        {validateFieldOnBlur(field, draft.values[field.key], t, language)}
                      </span>
                    </li>
                  ))}
                </ul>
              </SectionCard>
            ) : undefined
          }
          project={{
            ...project,
            name,
            submissionStatus: status,
            responses: draft.values,
            members,
            challenges,
          }}
          language={language}
          labels={{
            team: t("surfaceTeam"),
            challenges: t("challenges"),
            details: t("projectDetailsTitle"),
            pending: t("pendingInvitesTitle"),
            rank: t("rankLabel"),
            noMembers: t("noMembers"),
            noChallenges: t("noChallenges"),
          }}
          assetUrl={(path) => new URL(path, API_URL).toString()}
        />
      )}
    </PageLayout>
  );
}
