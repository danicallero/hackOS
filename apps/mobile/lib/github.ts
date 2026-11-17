import * as WebBrowser from "expo-web-browser";
import { apiFetch } from "@/lib/api";
import { createIdempotencyKey } from "@/lib/idempotency-key";
import { projectMutation } from "@/lib/projects";

/** The API callback hands a flow started here back to this URL (see `app.json` scheme). */
const APP_CALLBACK_URL = "hackos://github-callback";

export interface GithubStatus {
  configured: boolean;
  link: { fullName: string; isPrivate: boolean } | null;
}

export interface GithubRepoCandidate {
  installationId: number;
  id: number;
  fullName: string;
  isPrivate: boolean;
}

type CompleteOutcome =
  | { kind: "install"; url: string }
  | { kind: "profile" }
  | { kind: "select"; repoId: number };

/**
 * H18: links a project to a repository through the GitHub App. GitHub opens in
 * the system browser and returns to the app, which finishes the link under its
 * own session (the browser has none). Resolves true once the member's
 * repositories can be chosen, false when they closed the browser.
 */
export async function authorizeGithubForProject(
  projectId: number,
  authorize: boolean,
): Promise<boolean> {
  let { url } = await projectMutation<{ url: string }>(
    `/api/me/projects/${projectId}/github/install`,
    "POST",
    { authorize, app: true },
  );
  // Installing the App first returns here without a session, so loop until it is authorized.
  for (let step = 0; step < 3; step += 1) {
    const result = await WebBrowser.openAuthSessionAsync(url, APP_CALLBACK_URL);
    if (result.type !== "success") return false;
    const params = new URL(result.url).searchParams;
    const code = params.get("code");
    const state = params.get("state");
    if (!code || !state) return false;
    const installationId = params.get("installation_id");
    const outcome = await projectMutation<CompleteOutcome>("/api/me/github/complete", "POST", {
      code,
      state,
      ...(installationId ? { installationId: Number(installationId) } : {}),
    });
    if (outcome.kind !== "install") return true;
    url = outcome.url;
  }
  return false;
}

/** The member's linked GitHub account (#934): null login when none is linked. */
export interface GithubAccount {
  configured: boolean;
  login: string | null;
}

export function fetchGithubAccount(): Promise<GithubAccount> {
  return apiFetch<GithubAccount>("/api/me/github");
}

/**
 * #934, #935: links (or, with `selectAccount`, replaces) the member's GitHub
 * account from the profile editor, through the same app-callback flow as
 * projects. Resolves false when they closed the browser.
 */
export async function linkGithubAccount(selectAccount: boolean): Promise<boolean> {
  const { url } = await apiFetch<{ url: string }>("/api/me/github/authorize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ app: true, selectAccount }),
  });
  const result = await WebBrowser.openAuthSessionAsync(url, APP_CALLBACK_URL);
  if (result.type !== "success") return false;
  const params = new URL(result.url).searchParams;
  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state) return false;
  await apiFetch<CompleteOutcome>("/api/me/github/complete", {
    method: "POST",
    headers: { "content-type": "application/json", "Idempotency-Key": createIdempotencyKey() },
    body: JSON.stringify({ code, state }),
  });
  return true;
}
