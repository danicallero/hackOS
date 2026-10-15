"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useProjectDraft } from "@/app/(app)/my-project/[id]/use-project-draft";
import { AlertModal } from "@/components/common/alert-modal";
import { ContextualError } from "@/components/common/contextual-error";
import { PageHeader } from "@/components/common/page-header";
import { PageLayout } from "@/components/common/page-layout";
import { SaveStatus } from "@/components/common/save-status";
import { SectionCard } from "@/components/common/section-card";
import { type FieldValue, TemplateFieldControl } from "@/components/common/template-field-control";
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
import { type NativeProject, nativeProjects } from "@/lib/native-projects";
import { useUnsavedChangesGuard } from "@/lib/use-unsaved-changes-guard";
import { GalleryPhotoConsent } from "./gallery-photo-consent";
import { ProjectChallenges } from "./project-challenges";

export function ProjectEditor({
  project,
  staff = false,
}: {
  project: NativeProject;
  staff?: boolean;
}) {
  const { t, language } = useLocale();
  const router = useRouter();
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
      document.getElementById(`template-field-staff-${Object.keys(errors)[0]}`)?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (!(await draft.save())) return;
      const saved = await nativeProjects.submit(project.id);
      setStatus(saved.submissionStatus);
    } catch (cause) {
      setError(apiErrorText(cause, t, t("couldNotSaveDraft")));
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
      router.push("/my-project?view=all");
    } catch (cause) {
      setError(apiErrorText(cause, t, t("couldNotLeaveProject")));
      setBusy(false);
    }
  }
  return (
    <PageLayout>
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
      <PageHeader
        title={name || project.name}
        context={
          <Link href={staff ? "/projects" : "/my-project?view=all"}>
            {t(staff ? "projects" : "myProjects")}
          </Link>
        }
        state={t(status === "submitted" ? "dataStatusSubmitted" : "dataStatusDraft")}
      />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <SectionCard
            title={t("projectDetailsTitle")}
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
            <div className="space-y-6">
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
                <section className="space-y-4" key={group.section?.key ?? index}>
                  {group.section && (
                    <h3 className="font-medium text-balance">
                      {pickText(group.section.title, language)}
                    </h3>
                  )}
                  {group.fields.map((field) => (
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
                      disabled={!project.canEdit}
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
                  ))}
                </section>
              ))}
            </div>
          </SectionCard>
          <SectionCard
            title={t("surfaceTeam")}
            action={
              !staff && (
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
                    {staff && project.canEdit && (
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
            {staff && project.canEdit && (
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
            {!staff && (project.canInvite ?? project.canEdit) && (
              <form className="mt-4 space-y-2" onSubmit={invite}>
                <Label htmlFor="invite-email">{t("email")}</Label>
                <div className="flex flex-wrap gap-2">
                  <Input
                    id="invite-email"
                    className="flex-1"
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
            {!staff && <GalleryPhotoConsent />}
          </SectionCard>
        </div>
        <div className="space-y-6">
          <ProjectChallenges project={project} staff={staff}>
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
          </ProjectChallenges>
        </div>
      </div>
    </PageLayout>
  );
}
