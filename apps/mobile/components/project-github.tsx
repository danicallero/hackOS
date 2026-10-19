import { useFocusEffect, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useState } from "react";
import { ActionButton, Section, Separator } from "@/components/native-ui";
import { NavRow } from "@/components/project-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { apiFetch } from "@/lib/api";
import type { GithubStatus } from "@/lib/github";
import { useLocale } from "@/lib/i18n";
import { projectMutation } from "@/lib/projects";

const openUrl = (url: string) => void WebBrowser.openBrowserAsync(url);
const displayUrl = (url: string) => url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");

/** H18: the project's repository as a link, for viewers who cannot manage it. */
export function ProjectRepoRow({ url }: { url: string }) {
  return (
    <Section title="GitHub">
      <NavRow icon="link" title={displayUrl(url)} onPress={() => openUrl(url)} />
    </Section>
  );
}

/**
 * H18: links the project to one GitHub repository (private included) through
 * the GitHub App, or unlinks it. Choosing the repository happens in the
 * `/projects/github` sheet. Hidden when the App is not configured.
 */
export function ProjectGithubLink({
  projectId,
  repoUrl,
  locked,
}: {
  projectId: number;
  repoUrl?: string | null;
  /** A submitted project keeps its repository until it is withdrawn or returned. */
  locked: boolean;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const base = `/api/me/projects/${projectId}/github`;
  const [status, setStatus] = useState<GithubStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus(await apiFetch<GithubStatus>(base));
    } catch (cause) {
      setError(cause as Error);
    }
  }, [base]);
  // The repository sheet links and closes: refresh when returning to the editor.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function unlink() {
    setBusy(true);
    setError(null);
    try {
      await projectMutation(base, "DELETE");
      await load();
    } catch (cause) {
      setError(cause as Error);
    } finally {
      setBusy(false);
    }
  }

  if (!status?.configured) return error ? <RequestFeedback error={error} /> : null;
  const { link } = status;
  if (locked && !link) return repoUrl ? <ProjectRepoRow url={repoUrl} /> : null;
  return (
    <Section title="GitHub">
      {link ? (
        <>
          <NavRow
            icon="link"
            title={link.fullName}
            onPress={() => openUrl(`https://github.com/${link.fullName}`)}
          />
          {locked ? null : (
            <>
              <Separator />
              <ActionButton
                label={t("githubUnlinkRepo")}
                destructive
                disabled={busy}
                onPress={() => void unlink()}
              />
            </>
          )}
        </>
      ) : (
        <>
          {repoUrl ? (
            <>
              <NavRow icon="link" title={displayUrl(repoUrl)} onPress={() => openUrl(repoUrl)} />
              <Separator />
            </>
          ) : null}
          <NavRow
            icon="plus.circle.fill"
            title={t("githubLinkRepo")}
            onPress={() =>
              router.push({ pathname: "/projects/github", params: { id: String(projectId) } })
            }
          />
        </>
      )}
      {error ? <RequestFeedback error={error} /> : null}
    </Section>
  );
}
