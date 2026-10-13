"use client";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AccessDenied } from "@/components/common/access-denied";
import { ContextualError } from "@/components/common/contextual-error";
import { Spinner } from "@/components/common/spinner";
import { ProjectEditor } from "@/components/projects/project-editor";
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
    canAny(CAPABILITIES.PROJECTS_READ, CAPABILITIES.PROJECTS_EDIT, CAPABILITIES.JUDGE_PANEL) ||
    Boolean(me?.isEnterpriseJudge || me?.isSponsorRep);
  const [project, setProject] = useState<NativeProject | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!allowed) return;
    try {
      setProject(await api.get(`/api/repos/${id}`));
      setError(null);
    } catch (cause) {
      setError(apiErrorText(cause, t, t("couldNotLoadProject")));
    }
  }, [id, allowed, t]);
  useEffect(() => {
    void load();
  }, [load]);
  if (!allowed) return <AccessDenied ask={t("projectAccessDeniedDesc")} />;
  if (error) return <ContextualError message={error} onRetry={load} />;
  if (!project) return <Spinner />;
  return (
    <ProjectEditor
      key={project.id}
      project={{ ...project, canEdit: can(CAPABILITIES.PROJECTS_EDIT) }}
      staff
    />
  );
}
