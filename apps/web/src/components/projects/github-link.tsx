"use client";

import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/csr/ArrowSquareOut";
import { GithubLogoIcon } from "@phosphor-icons/react/dist/csr/GithubLogo";
import { useState } from "react";
import { ContextualError } from "@/components/common/contextual-error";
import { EntityCombobox } from "@/components/common/entity-combobox";
import { SectionCard } from "@/components/common/section-card";
import { Button } from "@/components/ui/button";
import { useServerResource } from "@/hooks/use-server-resource";
import { api } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import { useLocale } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import { ProjectAsideBlock } from "./project-aside-block";

interface Status {
  configured: boolean;
  link: { fullName: string; isPrivate: boolean } | null;
}
interface Candidate {
  installationId: number;
  id: number;
  fullName: string;
  isPrivate: boolean;
}

/** Links a project to one GitHub repository (private included) through the GitHub App. */
export function GithubLink({
  projectId,
  variant,
  locked = false,
}: {
  projectId: number;
  /** `aside` matches the project page's side facts; `plain` is the open editor section. */
  variant?: "plain" | "aside";
  /** A submitted project keeps its repository until it is withdrawn or returned. */
  locked?: boolean;
}) {
  const { t } = useLocale();
  const base = `/api/me/projects/${projectId}/github`;
  const status = useServerResource(["project-github", projectId], (signal) =>
    api.get<Status>(base, { signal }),
  );
  const repos = useServerResource(
    ["project-github-repos", projectId],
    (signal) => api.get<{ repos: Candidate[] }>(`${base}/repos`, { signal }),
    { enabled: status.data?.configured === true && !status.data.link },
  );
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!status.data?.configured) return null;
  const link = status.data.link;
  if (locked && !link) return null;

  async function run(action: () => Promise<unknown>, success?: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
      if (success) toast.success(success, { compactTitle: "GitHub" });
      status.reload();
    } catch (err) {
      setError(apiErrorText(err, t, t("couldNotLoadProject")));
    } finally {
      setBusy(false);
    }
  }

  const install = (authorize = false) =>
    run(async () => {
      const { url } = await api.post<{ url: string }>(
        `${base}/install`,
        authorize ? { authorize } : {},
      );
      window.location.assign(url);
    });

  const body = (
    <>
      {(error ?? (repos.error ? apiErrorText(repos.error, t, t("couldNotLoadProject")) : null)) && (
        <ContextualError
          message={error ?? apiErrorText(repos.error, t, t("couldNotLoadProject"))}
        />
      )}
      {link ? (
        <div className="flex items-center justify-between gap-3">
          <a
            className="row-link group flex min-h-10 min-w-0 flex-1 items-center gap-2 py-2 font-medium"
            href={`https://github.com/${link.fullName}`}
            target="_blank"
            rel="noreferrer"
          >
            <GithubLogoIcon aria-hidden="true" className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{link.fullName}</span>
            <ArrowSquareOutIcon
              aria-hidden="true"
              className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground"
            />
          </a>
          {!locked && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await api.delete(base);
                  // The App stays installed: re-read what it can access instead of reusing a stale list.
                  repos.reload();
                }, t("githubRepoUnlinked"))
              }
            >
              {t("githubUnlinkRepo")}
            </Button>
          )}
        </div>
      ) : repos.data && repos.data.repos.length > 0 ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <EntityCombobox
              className="min-w-0 flex-1"
              options={repos.data.repos}
              value={choice}
              onChange={setChoice}
              getId={(repo) => repo.id}
              getLabel={(repo) => repo.fullName}
              placeholder={t("githubChooseRepo")}
            />
            <Button
              disabled={busy || !choice}
              onClick={() =>
                run(
                  () => api.put(`${base}/repo`, { githubRepoId: Number(choice) }),
                  t("githubRepoLinked"),
                )
              }
            >
              {t("githubConfirmLink")}
            </Button>
          </div>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => install()}>
            {t("githubShareMoreRepos")}
          </Button>
        </div>
      ) : (
        <Button variant="outline" disabled={busy || repos.loading} onClick={() => install(true)}>
          <GithubLogoIcon aria-hidden="true" className="size-4" />
          {t("githubLinkRepo")}
        </Button>
      )}
    </>
  );
  return variant === "aside" ? (
    <ProjectAsideBlock title="GitHub">{body}</ProjectAsideBlock>
  ) : (
    <SectionCard title="GitHub" icon={GithubLogoIcon} variant={variant}>
      {body}
    </SectionCard>
  );
}
