"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ContextualError } from "@/components/common/contextual-error";
import { Spinner } from "@/components/common/spinner";
import { ProjectEditor } from "@/components/projects/project-editor";
import { apiErrorText } from "@/lib/api-error-text";
import { useLocale } from "@/lib/i18n";
import { type NativeProject, nativeProjects } from "@/lib/native-projects";

export default function MyProjectPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useLocale();
  const [project, setProject] = useState<NativeProject | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setProject(await nativeProjects.get(Number(id)));
      setError(null);
    } catch (cause) {
      setError(apiErrorText(cause, t, t("couldNotLoadProject")));
    }
  }, [id, t]);
  useEffect(() => {
    void load();
  }, [load]);
  if (error) return <ContextualError message={error} onRetry={load} />;
  if (!project) return <Spinner />;
  return <ProjectEditor key={project.id} project={project} />;
}
