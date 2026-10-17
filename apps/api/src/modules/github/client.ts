import { createHmac, createSign, timingSafeEqual } from "node:crypto";
import { config } from "../../config.js";
import { BadRequestError, ServiceUnavailableError } from "../../lib/errors.js";

// Minimal GitHub App client: JWT app auth, installation tokens, the OAuth
// user step that proves who is linking, and the few REST reads we need.

const API = "https://api.github.com";
const STATE_TTL_MS = 15 * 60 * 1000;

export function assertGithubConfigured(): void {
  if (!config.githubConfigured)
    throw new ServiceUnavailableError("GitHub integration is not configured");
}

function privateKey(): string {
  const raw = config.GITHUB_APP_PRIVATE_KEY_PEM ?? "";
  const pem = raw.includes("BEGIN") ? raw : Buffer.from(raw, "base64").toString("utf8");
  return pem.replace(/\\n/g, "\n");
}

const b64url = (value: Buffer | string) => Buffer.from(value).toString("base64url");

function appJwt(): string {
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(
    JSON.stringify({ iat: now - 60, exp: now + 540, iss: config.GITHUB_APP_ID }),
  )}`;
  let signature: Buffer;
  try {
    signature = createSign("RSA-SHA256").update(body).sign(privateKey());
  } catch {
    throw new ServiceUnavailableError(
      "GitHub App private key is invalid: set GITHUB_APP_PRIVATE_KEY_PEM to the PEM or its base64",
    );
  }
  return `${body}.${b64url(signature)}`;
}

async function gh<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path.startsWith("http") ? path : `${API}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "hackos",
      ...init.headers,
    },
  });
  if (!res.ok) throw new BadRequestError(`GitHub request failed (${res.status})`, { path });
  return (await res.json()) as T;
}

const tokenCache = new Map<number, { token: string; expiresAt: number }>();

export async function installationToken(installationId: number): Promise<string> {
  const cached = tokenCache.get(installationId);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const res = await gh<{ token: string; expires_at: string }>(
    `/app/installations/${installationId}/access_tokens`,
    appJwt(),
    { method: "POST" },
  );
  tokenCache.set(installationId, {
    token: res.token,
    expiresAt: new Date(res.expires_at).getTime(),
  });
  return res.token;
}

/** The OAuth `code` from the install redirect identifies the linking GitHub user. */
export async function exchangeUserCode(code: string) {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: config.GITHUB_APP_CLIENT_ID,
      client_secret: config.GITHUB_APP_CLIENT_SECRET,
      code,
    }),
  });
  const data = (await res.json()) as { access_token?: string };
  if (!res.ok || !data.access_token) throw new BadRequestError("GitHub authorization failed");
  const token = data.access_token;
  const user = await gh<{ id: number; login: string }>("/user", token);
  const installs = await gh<{ installations: { id: number }[] }>(
    "/user/installations?per_page=100",
    token,
  );
  return {
    githubId: user.id,
    login: user.login,
    installationIds: installs.installations.map((i) => i.id),
  };
}

export interface GithubRepo {
  id: number;
  full_name: string;
  private: boolean;
}

export async function listInstallationRepos(installationId: number): Promise<GithubRepo[]> {
  const token = await installationToken(installationId);
  const res = await gh<{ repositories: GithubRepo[] }>(
    "/installation/repositories?per_page=100",
    token,
  );
  return res.repositories;
}

export interface GithubCommit {
  sha: string;
  login: string | null;
  at: string;
}

export interface GithubPull {
  number: number;
  login: string | null;
  state: "open" | "closed";
  mergedAt: string | null;
  openedAt: string;
}

/** Up to 300 commits since the window opens; the webhook carries the rest. */
export async function listCommits(
  installationId: number,
  fullName: string,
  since: string | null,
): Promise<GithubCommit[]> {
  const token = await installationToken(installationId);
  const out: GithubCommit[] = [];
  for (let page = 1; page <= 3; page++) {
    const rows = await gh<
      {
        sha: string;
        author: { login: string } | null;
        commit: { author: { date: string } | null; committer: { date: string } | null };
      }[]
    >(
      `/repos/${fullName}/commits?per_page=100&page=${page}${since ? `&since=${encodeURIComponent(since)}` : ""}`,
      token,
    );
    for (const row of rows) {
      const at = row.commit.committer?.date ?? row.commit.author?.date;
      if (at) out.push({ sha: row.sha, login: row.author?.login ?? null, at });
    }
    if (rows.length < 100) break;
  }
  return out;
}

export async function listPulls(installationId: number, fullName: string): Promise<GithubPull[]> {
  const token = await installationToken(installationId);
  const out: GithubPull[] = [];
  for (let page = 1; page <= 3; page++) {
    const rows = await gh<
      {
        number: number;
        state: "open" | "closed";
        user: { login: string } | null;
        created_at: string;
        merged_at: string | null;
      }[]
    >(`/repos/${fullName}/pulls?state=all&per_page=100&page=${page}`, token);
    for (const row of rows)
      out.push({
        number: row.number,
        login: row.user?.login ?? null,
        state: row.state,
        mergedAt: row.merged_at,
        openedAt: row.created_at,
      });
    if (rows.length < 100) break;
  }
  return out;
}

export function verifyWebhookSignature(raw: Buffer, header: string | undefined): boolean {
  if (!header || !config.GITHUB_WEBHOOK_SECRET) return false;
  const expected = `sha256=${createHmac("sha256", config.GITHUB_WEBHOOK_SECRET).update(raw).digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(header);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Signed, expiring state binding the install redirect to one user and project. */
export function signState(userId: number, repoId: number | null): string {
  const body = b64url(JSON.stringify({ userId, repoId, exp: Date.now() + STATE_TTL_MS }));
  const mac = createHmac("sha256", config.BETTER_AUTH_SECRET).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function verifyState(state: string): { userId: number; repoId: number | null } {
  const [body = "", mac = ""] = state.split(".");
  const expected = createHmac("sha256", config.BETTER_AUTH_SECRET).update(body).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b))
    throw new BadRequestError("Invalid GitHub link state");
  const parsed = JSON.parse(Buffer.from(body, "base64url").toString()) as {
    userId: number;
    repoId: number | null;
    exp: number;
  };
  if (parsed.exp < Date.now()) throw new BadRequestError("GitHub link state expired");
  return { userId: parsed.userId, repoId: parsed.repoId };
}

export function installUrl(state: string): string {
  return `https://github.com/apps/${config.GITHUB_APP_SLUG}/installations/new?state=${encodeURIComponent(state)}`;
}

/** Account-only linking: GitHub asks the user to authorize the App, no repository involved. */
export function authorizeUrl(state: string): string {
  const redirect = `${config.BETTER_AUTH_URL}/api/github/callback`;
  return `https://github.com/login/oauth/authorize?client_id=${config.GITHUB_APP_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirect)}&state=${encodeURIComponent(state)}`;
}
