"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ContextualError } from "@/components/common/contextual-error";
import { PageHeader } from "@/components/common/page-header";
import { PageLayout } from "@/components/common/page-layout";
import { SectionCard } from "@/components/common/section-card";
import { SidePanelEditor } from "@/components/common/side-panel-editor";
import { Spinner } from "@/components/common/spinner";
import { ProjectListRow } from "@/components/projects/project-list-row";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import { useLocale } from "@/lib/i18n";
import { type NativeProject, nativeProjects } from "@/lib/native-projects";

type Invite = { id: number; projectId: number; name: string; invitedBy: string | null };
export default function MyProjectsPage() {
  const { t } = useLocale();
  const router = useRouter();
  const [projects, setProjects] = useState<NativeProject[] | null>(null);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [canCreate, setCanCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const [result, pending] = await Promise.all([
        nativeProjects.mine(),
        api.get<{ invites: Invite[] }>("/api/me/projects/invites"),
      ]);
      setProjects(result.projects);
      setInvites(pending.invites);
      setCanCreate(result.canCreate);
      setError(null);
      if (
        result.projects.length === 1 &&
        pending.invites.length === 0 &&
        new URLSearchParams(window.location.search).get("view") !== "all"
      )
        router.replace(`/my-project/${result.projects[0].id}`);
    } catch (cause) {
      setError(apiErrorText(cause, t, t("couldNotLoadProject")));
    }
  }, [router, t]);
  useEffect(() => {
    void load();
  }, [load]);
  async function create(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const project = await nativeProjects.create(name.trim());
      router.push(`/my-project/${project.id}`);
    } catch (cause) {
      setError(apiErrorText(cause, t, t("couldNotSaveProject")));
    } finally {
      setBusy(false);
    }
  }
  async function respond(id: number, action: "accept" | "decline") {
    setBusy(true);
    setError(null);
    try {
      await nativeProjects.respond(id, action);
      await load();
    } catch (cause) {
      setError(apiErrorText(cause, t, t("couldNotLoadProject")));
    } finally {
      setBusy(false);
    }
  }
  return (
    <PageLayout>
      <PageHeader
        title={t("myProjects")}
        primaryAction={
          canCreate && <Button onClick={() => setOpen(true)}>{t("createMyProjectCta")}</Button>
        }
      />
      {error && <ContextualError message={error} onRetry={load} />}
      {!projects && !error && <Spinner />}
      {invites.length > 0 && (
        <SectionCard title={t("pendingInvitesTitle")}>
          <ul className="divide-y divide-border/60">
            {invites.map((invite) => (
              <li
                className="flex flex-wrap items-center justify-between gap-3 py-3"
                key={invite.id}
              >
                <span>{invite.name}</span>
                <div className="flex gap-2">
                  <Button disabled={busy} onClick={() => void respond(invite.projectId, "accept")}>
                    {t("acceptInvite")}
                  </Button>
                  <Button
                    disabled={busy}
                    variant="outline"
                    onClick={() => void respond(invite.projectId, "decline")}
                  >
                    {t("declineInvite")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}
      {projects?.length === 0 && (
        <p className="text-muted-foreground">{t("myProjectsEmptyTitle")}</p>
      )}
      {projects && projects.length > 0 && (
        <div className="space-y-2">
          {projects.map((project) => (
            <ProjectListRow key={project.id} project={project} href={`/my-project/${project.id}`} />
          ))}
        </div>
      )}
      <SidePanelEditor
        open={open}
        onOpenChange={(value) => !busy && setOpen(value)}
        title={t("createMyProjectCta")}
        footer={
          <Button type="submit" form="create-project" loading={busy}>
            {t("createMyProjectCta")}
          </Button>
        }
      >
        <form id="create-project" onSubmit={create} className="space-y-2">
          <Label htmlFor="project-name">{t("projectNameLabel")}</Label>
          <Input
            id="project-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            disabled={busy}
          />
        </form>
        {error && <ContextualError message={error} />}
      </SidePanelEditor>
    </PageLayout>
  );
}
