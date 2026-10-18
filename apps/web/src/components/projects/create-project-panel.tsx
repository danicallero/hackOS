"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ContextualError } from "@/components/common/contextual-error";
import { MultiSelect } from "@/components/common/multi-select";
import { SidePanelEditor } from "@/components/common/side-panel-editor";
import { type FieldValue, TemplateFieldControl } from "@/components/common/template-field-control";
import { type UserOption, UserPicker, userOptionLabel } from "@/components/common/user-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useServerResource } from "@/hooks/use-server-resource";
import { api } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import { validateFieldOnBlur } from "@/lib/application-validation";
import { useLocale } from "@/lib/i18n";
import {
  invalidateProjectReads,
  type NativeProject,
  type ProjectDefinition,
} from "@/lib/native-projects";
import { useUnsavedChangesGuard } from "@/lib/use-unsaved-changes-guard";

type Challenge = {
  challengeId: number;
  title: string | Record<string, string>;
  mandatory: boolean;
};
export function CreateProjectPanel({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, language } = useLocale();
  const router = useRouter();
  const [name, setName] = useState("");
  const [members, setMembers] = useState<UserOption[]>([]);
  const [selectedChallenges, setSelectedChallenges] = useState<string[]>([]);
  const [responses, setResponses] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [metadataErrors, setMetadataErrors] = useState<{ name?: string; members?: string }>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const definition = useServerResource(
    ["project-form"],
    (signal) => api.get<ProjectDefinition>("/api/projects/form", { signal }),
    { enabled: open },
  );
  const challenges = useServerResource(
    ["project-challenges"],
    (signal) => api.get<Challenge[]>("/api/projects/estimates", { signal }),
    { enabled: open },
  );
  const challengeTitle = (challenge: Challenge) =>
    typeof challenge.title === "string"
      ? challenge.title
      : challenge.title[language] || challenge.title.en;
  const existing = useServerResource(
    ["projects", "management"],
    (signal) => api.get<{ repos: NativeProject[] }>("/api/repos", { signal }),
    { enabled: open },
  );
  const fields = (definition.data?.template ?? []).filter(
    (field) => field.kind !== "file" && field.kind !== "images",
  );
  useUnsavedChangesGuard(
    open && !busy && Boolean(name || members.length || Object.keys(responses).length),
  );
  function setFieldError(key: string, message: string | null) {
    setErrors((previous) => {
      const next = { ...previous };
      if (message) next[key] = message;
      else delete next[key];
      return next;
    });
  }
  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || !members.length) {
      setMetadataErrors({
        ...(!name.trim() ? { name: t("fieldRequired") } : {}),
        ...(!members.length ? { members: t("projectTeamRequired") } : {}),
      });
      document
        .getElementById(!name.trim() ? "staff-project-name" : "staff-project-member")
        ?.focus();
      return;
    }
    setMetadataErrors({});
    const validation: Record<string, string> = {};
    for (const field of fields) {
      const message = validateFieldOnBlur(
        { ...field, required: false },
        responses[field.key],
        t,
        language,
      );
      if (message) validation[field.key] = message;
    }
    setErrors(validation);
    if (Object.keys(validation).length) return;
    setBusy(true);
    setError(null);
    try {
      const project = await api.post<{ id: number }>("/api/repos", {
        name: name.trim(),
        memberUserIds: members.map((member) => member.id),
        challengeIds: selectedChallenges.map(Number),
        responses,
      });
      invalidateProjectReads(project.id);
      onOpenChange(false);
      setName("");
      setMembers([]);
      setSelectedChallenges([]);
      setResponses({});
      router.push(`/projects/${project.id}`);
    } catch (cause) {
      setError(apiErrorText(cause, t, t("couldNotSaveProject")));
    } finally {
      setBusy(false);
    }
  }
  return (
    <SidePanelEditor
      open={open}
      onOpenChange={onOpenChange}
      className="bg-popover"
      title={t("staffCreateProject")}
      description={t("staffCreateProjectNotice")}
      footer={
        <Button
          form="staff-create-project"
          type="submit"
          loading={busy}
          disabled={
            definition.loading ||
            challenges.loading ||
            Boolean(definition.error || challenges.error)
          }
        >
          {t("staffCreateProject")}
        </Button>
      }
    >
      {Boolean(error || definition.error || challenges.error || existing.error) && (
        <ContextualError
          message={
            error ??
            apiErrorText(
              definition.error ?? challenges.error ?? existing.error,
              t,
              t("couldNotLoadProjects"),
            )
          }
          onRetry={() => {
            definition.reload();
            challenges.reload();
            existing.reload();
          }}
        />
      )}
      <form id="staff-create-project" onSubmit={create} className="space-y-6" noValidate>
        <div className="space-y-2">
          <Label htmlFor="staff-project-name">{t("projectNameLabel")}</Label>
          <Input
            id="staff-project-name"
            value={name}
            maxLength={200}
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
            onBlur={() =>
              setMetadataErrors((previous) => ({
                ...previous,
                name: name.trim() ? undefined : t("fieldRequired"),
              }))
            }
            aria-invalid={Boolean(metadataErrors.name)}
            aria-describedby={metadataErrors.name ? "staff-project-name-error" : undefined}
          />
          {metadataErrors.name && (
            <p id="staff-project-name-error" role="alert" className="text-sm text-destructive">
              {metadataErrors.name}
            </p>
          )}
        </div>
        <section className="space-y-3">
          <Label htmlFor="staff-project-member">{t("surfaceTeam")}</Label>
          <ul className="divide-y divide-border/60">
            {members.map((member) => (
              <li key={member.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0 space-y-1">
                  <span className="wrap-anywhere text-sm">{userOptionLabel(member)}</span>
                  {(existing.data?.repos ?? [])
                    .filter((project) =>
                      project.members?.some(
                        (entry) => entry.userId === member.id && entry.status === "active",
                      ),
                    )
                    .map((project) => (
                      <Button
                        key={project.id}
                        asChild
                        variant="link"
                        size="sm"
                        className="block h-auto px-0 text-left"
                      >
                        <Link href={`/projects/${project.id}`}>{project.name}</Link>
                      </Button>
                    ))}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    setMembers((current) => current.filter((item) => item.id !== member.id))
                  }
                >
                  {t("remove")}
                </Button>
              </li>
            ))}
          </ul>
          <UserPicker
            key={members.map((member) => member.id).join(",")}
            id="staff-project-member"
            aria-invalid={Boolean(metadataErrors.members)}
            onBlur={() =>
              setMetadataErrors((previous) => ({
                ...previous,
                members: members.length ? undefined : t("projectTeamRequired"),
              }))
            }
            value=""
            onChange={(_, user) => {
              if (user)
                setMembers((current) =>
                  current.some((member) => member.id === user.id) ? current : [...current, user],
                );
              setMetadataErrors((previous) => ({ ...previous, members: undefined }));
            }}
            search={async (q) =>
              (
                await api.get<{ users: UserOption[] }>("/api/projects/member-candidates", {
                  query: { q },
                })
              ).users.filter((user) => !members.some((member) => member.id === user.id))
            }
            minQueryLength={2}
            disabled={busy}
            inDialog
            aria-describedby={metadataErrors.members ? "staff-project-team-error" : undefined}
          />
          {metadataErrors.members && (
            <p id="staff-project-team-error" role="alert" className="text-sm text-destructive">
              {metadataErrors.members}
            </p>
          )}
        </section>
        <div className="space-y-2">
          <Label htmlFor="staff-project-challenges">{t("challenges")}</Label>
          <MultiSelect
            id="staff-project-challenges"
            inDialog
            options={(challenges.data ?? [])
              .filter((challenge) => !challenge.mandatory)
              .map((challenge) => ({
                value: String(challenge.challengeId),
                label: challengeTitle(challenge),
              }))}
            value={selectedChallenges}
            onChange={setSelectedChallenges}
            disabled={busy}
          />
          {(challenges.data ?? [])
            .filter((challenge) => challenge.mandatory)
            .map((challenge) => (
              <p key={challenge.challengeId} className="text-sm text-muted-foreground">
                {challengeTitle(challenge)} · {t("required")}
              </p>
            ))}
        </div>
        {fields.map((field) => (
          <TemplateFieldControl
            key={field.key}
            field={{ ...field, required: false }}
            value={responses[field.key] as FieldValue}
            lang={language}
            inDialog
            disabled={busy}
            error={errors[field.key]}
            onChange={(value) => setResponses((previous) => ({ ...previous, [field.key]: value }))}
            onBlur={(value) =>
              setFieldError(
                field.key,
                validateFieldOnBlur({ ...field, required: false }, value, t, language),
              )
            }
          />
        ))}
        {definition.data?.template.some(
          (field) => field.kind === "file" || field.kind === "images",
        ) && <p className="text-sm text-muted-foreground">{t("projectFilesAfterCreation")}</p>}
      </form>
    </SidePanelEditor>
  );
}
