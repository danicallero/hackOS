"use client";
import { useState } from "react";
import { ContextualError } from "@/components/common/contextual-error";
import { EntityCombobox } from "@/components/common/entity-combobox";
import { SectionCard } from "@/components/common/section-card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useServerResource } from "@/hooks/use-server-resource";
import { api } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import { useLocale } from "@/lib/i18n";
import { invalidateProjectReads, type NativeProject, nativeProjects } from "@/lib/native-projects";
import { PresentationStatus } from "./presentation-status";

type Challenge = NativeProject["challenges"][number] & {
  status?: string | null;
  position?: number | null;
  etaMinutes?: number | null;
  assignedRoomName?: string | null;
};
export function ProjectChallenges({
  project,
  staff,
  children,
  onChange,
}: {
  project: NativeProject;
  staff: boolean;
  onChange?: (challenges: NativeProject["challenges"]) => void;
  /** Further challenge-related settings shown in the same section (presentation time). */
  children?: React.ReactNode;
}) {
  const { t, language } = useLocale();
  const [challenges, setChallenges] = useState(project.challenges);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editable = project.canEdit;
  const catalogueResource = useServerResource(
    ["project-challenges", staff ? "staff" : "public"],
    async (signal) => {
      if (!staff)
        return (await api.get<{ items: Challenge[] }>("/api/public/challenges", { signal })).items;
      return (
        await api.get<Array<Challenge & { challengeId: number }>>("/api/projects/estimates", {
          signal,
        })
      ).map((challenge) => ({ ...challenge, id: challenge.challengeId }));
    },
    { enabled: editable },
  );
  const catalogue = catalogueResource.data ?? [];
  async function change(id: number, remove: boolean) {
    setBusy(true);
    setError(null);
    try {
      if (staff) {
        if (remove) await api.delete(`/api/repos/${project.id}/challenges/${id}`);
        else await api.post(`/api/repos/${project.id}/challenges`, { challengeId: id });
      } else if (remove) await nativeProjects.removeChallenge(project.id, id);
      else await nativeProjects.addChallenge(project.id, id);
      invalidateProjectReads(project.id);
      const updated = staff
        ? await api.get<NativeProject>(`/api/repos/${project.id}`)
        : await nativeProjects.get(project.id);
      setChallenges(updated.challenges);
      onChange?.(updated.challenges);
      setSelected("");
    } catch (cause) {
      setError(apiErrorText(cause, t, t("couldNotSaveProject")));
    } finally {
      setBusy(false);
    }
  }
  const title = (challenge: Challenge) =>
    typeof challenge.title === "string"
      ? challenge.title
      : challenge.title[language] || challenge.title.en;
  return (
    <SectionCard title={t("challenges")}>
      {Boolean(error || catalogueResource.error) && (
        <ContextualError
          message={error ?? apiErrorText(catalogueResource.error, t, t("couldNotLoadChallenge"))}
          onRetry={catalogueResource.reload}
        />
      )}
      <ul className="divide-y divide-border/60">
        {challenges.map((challenge) => (
          <li className="space-y-2 py-3" key={challenge.id}>
            <div className="flex items-center justify-between gap-3">
              <span>{title(challenge)}</span>
              {challenge.mandatory && (
                <span className="text-muted-foreground px-3 text-sm">{t("required")}</span>
              )}
              {editable && !challenge.mandatory && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => void change(challenge.id, true)}
                >
                  {t("remove")}
                </Button>
              )}
            </div>
            <PresentationStatus
              status={challenge.status ?? null}
              position={challenge.position ?? null}
              etaMinutes={challenge.etaMinutes ?? null}
              assignedRoomName={challenge.assignedRoomName}
            />
          </li>
        ))}
      </ul>
      {editable && (
        <div className="space-y-2">
          <Label htmlFor="project-challenge">{t("addChallenge")}</Label>
          <EntityCombobox
            id="project-challenge"
            options={catalogue.filter(
              (challenge) => !challenges.some((current) => current.id === challenge.id),
            )}
            value={selected}
            onChange={(id) => {
              // Choosing a challenge is the action; no separate confirm button.
              setSelected(id);
              if (id) void change(Number(id), false);
            }}
            getId={(challenge) => challenge.id}
            getLabel={title}
            disabled={busy}
          />
        </div>
      )}
      {children}
    </SectionCard>
  );
}
