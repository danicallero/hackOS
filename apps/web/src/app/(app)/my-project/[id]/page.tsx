"use client";

import { useParams } from "next/navigation";
import { ContextualError } from "@/components/common/contextual-error";
import { Spinner } from "@/components/common/spinner";
import { ProjectEditor } from "@/components/projects/project-editor";
import { useServerResource } from "@/hooks/use-server-resource";
import { api } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import { useLocale } from "@/lib/i18n";
import type { NativeProject } from "@/lib/native-projects";

export default function MyProjectPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useLocale();
  const resource = useServerResource(
    ["project", id, "member"],
    (signal) => api.get<NativeProject>(`/api/me/projects/${id}`, { signal }),
    { enabled: true },
  );
  const project = resource.data;
  if (resource.error)
    return (
      <ContextualError
        message={apiErrorText(resource.error, t, t("couldNotLoadProject"))}
        onRetry={resource.reload}
      />
    );
  if (!project) return <Spinner />;
  return <ProjectEditor key={project.id} project={project} />;
}
