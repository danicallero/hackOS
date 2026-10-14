"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { useCallback, useEffect, useState } from "react";
import { QuestionsCard } from "@/app/(app)/applications/[id]/questions-card";
import { AccessDenied } from "@/components/common/access-denied";
import { ContextualError } from "@/components/common/contextual-error";
import { PageHeader } from "@/components/common/page-header";
import { PageLayout } from "@/components/common/page-layout";
import { Spinner } from "@/components/common/spinner";
import { apiErrorText } from "@/lib/api-error-text";
import { useLocale } from "@/lib/i18n";
import { nativeProjects, type ProjectDefinition } from "@/lib/native-projects";
import { useCan } from "@/lib/session";
import { useUnsavedChangesGuard } from "@/lib/use-unsaved-changes-guard";

export default function ProjectFormPage() {
  const { t } = useLocale();
  const allowed = useCan(CAPABILITIES.PROJECTS_EDIT);
  const [dirty, setDirty] = useState(false);
  useUnsavedChangesGuard(dirty);
  const [definition, setDefinition] = useState<ProjectDefinition | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!allowed) return;
    try {
      setDefinition(await nativeProjects.definition());
      setError(null);
    } catch (cause) {
      setError(apiErrorText(cause, t, t("couldNotLoadProject")));
    }
  }, [allowed, t]);
  useEffect(() => {
    void load();
  }, [load]);
  if (!allowed) return <AccessDenied ask={t("projectAccessDeniedDesc")} />;
  return (
    <PageLayout>
      <PageHeader title={t("formFields")} />
      {error ? (
        <ContextualError message={error} onRetry={load} />
      ) : definition ? (
        <QuestionsCard
          form={{ id: 1, name: t("projects"), ...definition }}
          onSaved={load}
          onDirtyChange={setDirty}
          saveDefinition={({ template, sections }) =>
            nativeProjects.saveDefinition({ template, sections })
          }
        />
      ) : (
        <Spinner />
      )}
    </PageLayout>
  );
}
