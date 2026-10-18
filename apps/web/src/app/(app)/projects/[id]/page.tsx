"use client";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { useParams } from "next/navigation";
import { AccessDenied } from "@/components/common/access-denied";
import { ContextualError } from "@/components/common/contextual-error";
import { Spinner } from "@/components/common/spinner";
import { ProjectEditor } from "@/components/projects/project-editor";
import { useServerResource } from "@/hooks/use-server-resource";
import { api } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import { useLocale } from "@/lib/i18n";
import type { NativeProject } from "@/lib/native-projects";
import { useSessionContext } from "@/lib/session";
export default function StaffProjectPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useLocale();
  const { can, canAny, me } = useSessionContext();
  const allowed =
    canAny(CAPABILITIES.PROJECTS_READ, CAPABILITIES.PROJECTS_EDIT) ||
    Boolean(me?.isEnterpriseJudge || me?.isSponsorRep);
  const resource = useServerResource(
    ["project", id, "staff"],
    (signal) => api.get<NativeProject>(`/api/repos/${id}`, { signal }),
    { enabled: allowed },
  );
  const project = resource.data;
  if (!allowed) return <AccessDenied ask={t("projectAccessDeniedDesc")} />;
  if (resource.error)
    return (
      <ContextualError
        message={apiErrorText(resource.error, t, t("couldNotLoadProject"))}
        onRetry={resource.reload}
      />
    );
  if (!project) return <Spinner />;
  return (
    <ProjectEditor
      key={project.id}
      project={{ ...project, canEdit: project.canEdit && can(CAPABILITIES.PROJECTS_EDIT) }}
      staff
    />
  );
}
