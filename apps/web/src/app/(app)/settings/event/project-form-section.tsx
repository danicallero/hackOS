"use client";

// Project form editor (H19), hosted in Event settings next to the project
// dates it complements. Gated by PROJECTS_EDIT.

import { useCallback, useEffect, useState } from "react";
import { ContextualError } from "@/components/common/contextual-error";
import { Spinner } from "@/components/common/spinner";
import { QuestionsCard } from "@/components/forms/questions-card";
import { apiErrorText } from "@/lib/api-error-text";
import { useLocale } from "@/lib/i18n";
import { nativeProjects, type ProjectDefinition } from "@/lib/native-projects";

export function ProjectFormSection({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const { t } = useLocale();
  const [definition, setDefinition] = useState<ProjectDefinition | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setDefinition(await nativeProjects.definition());
      setError(null);
    } catch (cause) {
      setError(apiErrorText(cause, t, t("couldNotLoadProject")));
    }
  }, [t]);
  useEffect(() => {
    void load();
  }, [load]);
  if (error) return <ContextualError message={error} onRetry={load} />;
  if (!definition) return <Spinner />;
  return (
    <QuestionsCard
      form={{ id: 1, name: t("projects"), ...definition }}
      onSaved={load}
      onDirtyChange={onDirtyChange}
      saveDefinition={({ template, sections, library_deletions }) =>
        nativeProjects.saveDefinition({ template, sections, library_deletions })
      }
    />
  );
}
