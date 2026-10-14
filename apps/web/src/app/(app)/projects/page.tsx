"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AccessDenied } from "@/components/common/access-denied";
import { ContextualError } from "@/components/common/contextual-error";
import { type Column, DataTable } from "@/components/common/data-table";
import { ListToolbar } from "@/components/common/list-toolbar";
import { PageHeader } from "@/components/common/page-header";
import { PageLayout } from "@/components/common/page-layout";
import { SidePanelEditor } from "@/components/common/side-panel-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import { useLocale } from "@/lib/i18n";
import type { NativeProject } from "@/lib/native-projects";
import { useSessionContext } from "@/lib/session";

export default function ProjectsPage() {
  const { t } = useLocale();
  const router = useRouter();
  const { can, canAny, me } = useSessionContext();
  const canEdit = can(CAPABILITIES.PROJECTS_EDIT);
  const allowed =
    canAny(CAPABILITIES.PROJECTS_READ, CAPABILITIES.JUDGE_PANEL) ||
    Boolean(me?.isEnterpriseJudge || me?.isSponsorRep);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [projects, setProjects] = useState<NativeProject[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!allowed) return;
    try {
      setProjects((await api.get<{ repos: NativeProject[] }>("/api/repos")).repos);
      setError(null);
    } catch (cause) {
      setError(apiErrorText(cause, t, t("couldNotLoadProjects")));
    } finally {
      setLoading(false);
    }
  }, [allowed, t]);
  useEffect(() => {
    void load();
  }, [load]);
  async function create(event: React.FormEvent) {
    event.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const result = await api.post<{ id: number }>("/api/repos", { name: name.trim() });
      router.push(`/projects/${result.id}`);
    } catch (cause) {
      setError(apiErrorText(cause, t, t("couldNotSaveProject")));
    } finally {
      setCreating(false);
    }
  }
  const columns: Column<NativeProject>[] = [
    {
      id: "name",
      header: t("projectNameLabel"),
      cell: (project) => (
        <Link href={`/projects/${project.id}`} className="font-medium">
          {project.name}
        </Link>
      ),
    },
    {
      id: "members",
      header: t("surfaceTeam"),
      cell: (project) =>
        project.members
          ?.filter((member) => member.status === "active")
          .map((member) => member.name)
          .join(", "),
    },
    {
      id: "status",
      header: t("inviteStatus"),
      cell: (project) =>
        t(project.submissionStatus === "submitted" ? "dataStatusSubmitted" : "dataStatusDraft"),
    },
  ];
  if (!allowed) return <AccessDenied ask={t("projectAccessDeniedDesc")} />;
  return (
    <PageLayout>
      <PageHeader
        title={t("projects")}
        primaryAction={
          canEdit && <Button onClick={() => setCreateOpen(true)}>{t("createMyProjectCta")}</Button>
        }
        secondaryActions={
          canEdit && (
            <Button asChild variant="outline">
              <Link href="/projects/form">{t("formFields")}</Link>
            </Button>
          )
        }
      />
      <ListToolbar
        search={{
          value: search,
          onValueChange: setSearch,
          label: t("search"),
          placeholder: t("projectNameLabel"),
        }}
      />
      {error && <ContextualError message={error} onRetry={load} />}
      <DataTable
        columns={columns}
        data={projects.filter((project) =>
          project.name.toLowerCase().includes(search.toLowerCase()),
        )}
        getRowId={(project) => String(project.id)}
        loading={loading}
        onRowClick={(project) => router.push(`/projects/${project.id}`)}
      />
      <SidePanelEditor
        open={createOpen}
        onOpenChange={(value) => !creating && setCreateOpen(value)}
        title={t("createMyProjectCta")}
        footer={
          <Button form="staff-create-project" type="submit" loading={creating}>
            {t("createMyProjectCta")}
          </Button>
        }
      >
        <form id="staff-create-project" onSubmit={create} className="space-y-2">
          <Label htmlFor="staff-project-name">{t("projectNameLabel")}</Label>
          <Input
            id="staff-project-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            disabled={creating}
          />
        </form>
        {error && <ContextualError message={error} />}
      </SidePanelEditor>
    </PageLayout>
  );
}
