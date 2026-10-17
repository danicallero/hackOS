"use client";

import { GithubLogoIcon } from "@phosphor-icons/react/dist/csr/GithubLogo";
import { useState } from "react";
import { ContextualError } from "@/components/common/contextual-error";
import { SectionCard } from "@/components/common/section-card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
export function GithubLink({ projectId }: { projectId: number }) {
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

  const install = () =>
    run(async () => {
      const { url } = await api.post<{ url: string }>(`${base}/install`, {});
      window.location.assign(url);
    });

  return (
    <SectionCard title="GitHub" icon={GithubLogoIcon}>
      {error && <ContextualError message={error} />}
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
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => run(() => api.delete(base), t("githubRepoUnlinked"))}
          >
            {t("githubUnlinkRepo")}
          </Button>
        </div>
      ) : repos.data && repos.data.repos.length > 0 ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Select value={choice} onValueChange={setChoice}>
              <SelectTrigger className="min-w-0 flex-1" aria-label={t("githubChooseRepo")}>
                <SelectValue placeholder={t("githubChooseRepo")} />
              </SelectTrigger>
              <SelectContent>
                {repos.data.repos.map((repo) => (
                  <SelectItem key={`${repo.installationId}-${repo.id}`} value={String(repo.id)}>
                    {repo.fullName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
          <Button variant="ghost" size="sm" disabled={busy} onClick={install}>
            {t("githubShareMoreRepos")}
          </Button>
        </div>
      ) : (
        <Button variant="outline" disabled={busy} onClick={install}>
          <GithubLogoIcon aria-hidden="true" className="size-4" />
          {t("githubLinkRepo")}
        </Button>
      )}
    </SectionCard>
  );
}
