"use client";

// Native project create/edit form (H18) shared with participant
// self-creation (H19). Metadata + optional challenge lineup on create;
// team membership stays on the detail page (H21 surfaces).

import { FolderPlusIcon, type LucideIcon, PencilIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Modal } from "@/components/common/modal";
import { MultiSelect, type MultiSelectOption } from "@/components/common/multi-select";
import { SubmitButton } from "@/components/common/submit-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { createMyProject, createRepo, updateRepo } from "@/lib/projects";
import { challengeTitleText, type ProjectRepo } from "./shared";

type ChallengeOption = { id: number; title: Record<string, string> | string };

export type ProjectFormMode =
  | { kind: "create" } // org-side (PROJECTS_EDIT), full challenge catalogue
  | { kind: "self" } // participant (H19), public challenges only
  | { kind: "edit"; repo: ProjectRepo }; // metadata only

export function ProjectFormDialog({
  mode,
  onSaved,
}: {
  mode: ProjectFormMode;
  onSaved: (repoId: number) => void | Promise<void>;
}) {
  const { t } = useLocale();
  const isEdit = mode.kind === "edit";
  const initial = isEdit ? mode.repo : null;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [githubUrl, setGithubUrl] = useState(initial?.github_url ?? "");
  const [demoUrl, setDemoUrl] = useState(initial?.demo_url ?? "");
  const [challengeIds, setChallengeIds] = useState<string[]>([]);
  const [challenges, setChallenges] = useState<ChallengeOption[]>([]);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open || isEdit) return;
    const load =
      mode.kind === "create"
        ? api.get<{ challenges: ChallengeOption[] }>("/api/challenges").then((r) => r.challenges)
        : api.get<{ items: ChallengeOption[] }>("/api/public/challenges").then((r) => r.items);
    load.then(setChallenges).catch(() => setChallenges([]));
  }, [open, isEdit, mode.kind]);

  function resetToInitial() {
    setName(initial?.name ?? "");
    setDescription(initial?.description ?? "");
    setGithubUrl(initial?.github_url ?? "");
    setDemoUrl(initial?.demo_url ?? "");
    setChallengeIds([]);
  }

  async function submit() {
    setPending(true);
    try {
      const urls = {
        githubUrl: githubUrl.trim() || null,
        demoUrl: demoUrl.trim() || null,
      };
      if (mode.kind === "edit") {
        const updated = await updateRepo(mode.repo.id, {
          name: name.trim(),
          description: description.trim(),
          ...urls,
        });
        toast.success(t("projectSaved"));
        setOpen(false);
        await onSaved(updated.id as number);
      } else {
        const input = {
          name: name.trim(),
          description: description.trim(),
          ...urls,
          challengeIds: challengeIds.map(Number),
        };
        const created =
          mode.kind === "create"
            ? await createRepo(input, crypto.randomUUID())
            : await createMyProject(input, crypto.randomUUID());
        toast.success(t("projectCreated"));
        setOpen(false);
        resetToInitial();
        await onSaved(created.repo.id as number);
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotSaveProject"));
    } finally {
      setPending(false);
    }
  }

  const challengeOptions: MultiSelectOption[] = challenges.map((c) => ({
    value: String(c.id),
    label: challengeTitleText(c.title),
  }));

  const TriggerIcon: LucideIcon = isEdit ? PencilIcon : FolderPlusIcon;
  const triggerLabel = isEdit
    ? t("editProject")
    : mode.kind === "self"
      ? t("createMyProjectCta")
      : t("newProject");

  return (
    <Modal
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) resetToInitial();
      }}
      trigger={
        <Button variant={isEdit ? "outline" : "default"}>
          <TriggerIcon className="size-4" /> {triggerLabel}
        </Button>
      }
      icon={TriggerIcon}
      title={triggerLabel}
      description={isEdit ? t("editProjectDesc") : t("newProjectDesc")}
      footer={
        <SubmitButton pending={pending} disabled={!name.trim()} onClick={submit}>
          {isEdit ? t("save") : t("create")}
        </SubmitButton>
      }
    >
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="project-name">{t("projectNameLabel")}</Label>
          <Input
            id="project-name"
            value={name}
            maxLength={200}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="project-description">{t("descriptionLabel")}</Label>
          <Textarea
            id="project-description"
            value={description}
            rows={4}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="project-github">{t("projectRepoUrlLabel")}</Label>
            <Input
              id="project-github"
              type="url"
              value={githubUrl}
              placeholder="https://github.com/…"
              onChange={(e) => setGithubUrl(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="project-demo">{t("projectDemoUrlLabel")}</Label>
            <Input
              id="project-demo"
              type="url"
              value={demoUrl}
              placeholder="https://…"
              onChange={(e) => setDemoUrl(e.target.value)}
            />
          </div>
        </div>
        {!isEdit && (
          <div className="space-y-2">
            <Label htmlFor="project-challenges">{t("challenges")}</Label>
            <MultiSelect
              inDialog
              id="project-challenges"
              options={challengeOptions}
              value={challengeIds}
              onChange={setChallengeIds}
              placeholder={t("selectChallengePlaceholder")}
            />
            <p className="text-muted-foreground text-xs">{t("projectChallengesHint")}</p>
          </div>
        )}
      </div>
    </Modal>
  );
}
