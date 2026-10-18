"use client";

import { GithubLogoIcon } from "@phosphor-icons/react/dist/csr/GithubLogo";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useServerResource } from "@/hooks/use-server-resource";
import { api } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import { useLocale } from "@/lib/i18n";
import { toast } from "@/lib/toast";

interface Status {
  configured: boolean;
  login: string | null;
}

/** Links the member's GitHub login so their commits and pull requests are ranked under their name. */
export function GithubRow() {
  const { t } = useLocale();
  const status = useServerResource(["me-github"], (signal) =>
    api.get<Status>("/api/me/github", { signal }),
  );
  const [busy, setBusy] = useState(false);
  if (!status.data?.configured) return null;
  const login = status.data.login;

  async function run(action: () => Promise<unknown>, success?: string) {
    setBusy(true);
    try {
      await action();
      if (success) toast.success(success, { compactTitle: "GitHub" });
      status.reload();
    } catch (err) {
      toast.error(apiErrorText(err, t, t("couldNotLoadProject")), { compactTitle: "GitHub" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <GithubLogoIcon aria-hidden="true" className="text-muted-foreground size-5 shrink-0" />
      <p className="min-w-0 flex-1 truncate text-sm font-medium">{login ?? "GitHub"}</p>
      {login ? (
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => run(() => api.delete("/api/me/github"), t("githubRepoUnlinked"))}
        >
          {t("githubUnlinkRepo")}
        </Button>
      ) : (
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const { url } = await api.post<{ url: string }>("/api/me/github/authorize", {});
              window.location.assign(url);
            })
          }
        >
          {t("githubLinkAccount")}
        </Button>
      )}
    </li>
  );
}
