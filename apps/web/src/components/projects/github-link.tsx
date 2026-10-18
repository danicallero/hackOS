"use client";

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
  variant?: "plain";
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

  return (
    <SectionCard title="GitHub" icon={GithubLogoIcon} variant={variant}>
      {(error ?? (repos.error ? apiErrorText(repos.error, t, t("couldNotLoadProject")) : null)) && (
        <ContextualError
          message={error ?? apiErrorText(repos.error, t, t("couldNotLoadProject"))}
        />
      )}
      {link ? (
        <div className="flex items-center justify-between gap-3">
          <a
            className="min-w-0 truncate font-medium underline"
            href={`https://github.com/${link.fullName}`}
            target="_blank"
            rel="noreferrer"
          >
            {link.fullName}
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
    </SectionCard>
  );
}
