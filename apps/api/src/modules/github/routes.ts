import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { config } from "../../config.js";
import { pool } from "../../db/pool.js";
import { requireAuth } from "../../lib/capabilities.js";
import { BadRequestError, UnauthorizedError } from "../../lib/errors.js";
import { idempotencyGuard } from "../../lib/idempotency.js";
import { sharedCache } from "../../lib/shared-cache.js";
import {
  assertGithubConfigured,
  authorizeUrl,
  exchangeUserCode,
  installUrl,
  signState,
  verifyState,
  verifyWebhookSignature,
} from "./client.js";
import {
  accountStatus,
  assertActiveMember,
  backfill,
  leaderboard,
  linkRepo,
  linkStatus,
  recordCommits,
  recordPull,
  removeInstallation,
  repoForGithubId,
  saveAccount,
  saveInstallations,
  saveUserAuthorization,
  selectableRepos,
  unlinkAccount,
  unlinkRepo,
} from "./service.js";

const params = z.object({ id: z.coerce.number().int().positive() });
const member = {
  config: { routeAccessPolicy: { kind: "authenticated" as const } },
  preHandler: [requireAuth, idempotencyGuard],
};

interface WebhookPayload {
  action?: string;
  installation: { id: number };
  repository?: { id: number };
  commits?: { id: string; author?: { username?: string } | null; timestamp: string }[];
  pull_request?: {
    number: number;
    state: "open" | "closed";
    user?: { login: string } | null;
    created_at: string;
    merged_at: string | null;
  };
}

function actor(userId: number | null | undefined): number {
  if (userId == null) throw new UnauthorizedError();
  return userId;
}

/** In production the backfill is fire-and-forget; tests await it for determinism. */
async function runBackfill(repoId: number): Promise<void> {
  const done = backfill(repoId).catch((err) =>
    console.error(`[github] backfill(${repoId}) failed`, err),
  );
  if (config.isTest) await done;
}

export function registerGithubRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/api/me/projects/:id/github",
    {
      ...member,
      preHandler: requireAuth,
      schema: {
        params,
        summary: "Read a project's GitHub link",
        description:
          "Whether the GitHub App is configured and which repository the project links, for active team members only.",
      },
    },
    async (q) => {
      await assertActiveMember(actor(q.userId), q.params.id);
      return { configured: config.githubConfigured, link: await linkStatus(q.params.id) };
    },
  );

  r.post(
    "/api/me/projects/:id/github/install",
    {
      ...member,
      schema: {
        params,
        body: z.object({ authorize: z.boolean().optional() }).optional(),
        summary: "Start linking a GitHub repository",
        description:
          "Returns the GitHub App installation URL, bound by a signed 15-minute state to this member and project. GitHub redirects back to /api/github/callback, which proves the installation belongs to the member's GitHub account. With authorize=true it returns the account authorization URL instead, which always redirects back and finds installations the App already has, since GitHub shows no redirect when the App is already installed.",
      },
    },
    async (q) => {
      assertGithubConfigured();
      const userId = actor(q.userId);
      await assertActiveMember(userId, q.params.id);
      const state = signState(userId, q.params.id);
      return { url: q.body?.authorize ? authorizeUrl(state) : installUrl(state) };
    },
  );

  r.get(
    "/api/github/callback",
    {
      config: { routeAccessPolicy: { kind: "authenticated" as const } },
      // Expired session: bounce through login and resume this exact callback (H18).
      preHandler: [
        async (req, reply) => {
          if (req.userId == null) {
            return reply.redirect(
              `${config.WEB_URL}/login?next=${encodeURIComponent(req.raw.url ?? "/")}`,
            );
          }
        },
        requireAuth,
      ],
      schema: {
        querystring: z.object({
          installation_id: z.coerce.number().int().positive().optional(),
          code: z.string().min(1),
          state: z.string().min(1),
        }),
        summary: "GitHub App installation callback",
        description:
          "Verifies the signed state against the signed-in member, exchanges the OAuth code to learn the GitHub account, requires that account to own the installation, then redirects to the project page. Without a session it redirects to the login page, which returns here afterwards.",
      },
    },
    async (q, reply) => {
      assertGithubConfigured();
      const userId = actor(q.userId);
      const state = verifyState(q.query.state);
      if (state.userId !== userId) throw new BadRequestError("Invalid GitHub link state");
      const account = await exchangeUserCode(q.query.code);
      if (state.repoId == null) {
        await saveAccount(userId, account);
        await saveInstallations(userId, account.installationIds);
        return reply.redirect(`${config.WEB_URL}/settings/profile?github=linked`);
      }
      await assertActiveMember(userId, state.repoId);
      if (q.query.installation_id == null) {
        // Authorization-only return: reuse installations the App already has, else install it.
        if (account.installationIds.length === 0)
          return reply.redirect(installUrl(signState(userId, state.repoId)));
        await saveAccount(userId, account);
        await saveInstallations(userId, account.installationIds);
        return reply.redirect(`${config.WEB_URL}/my-project/${state.repoId}?github=select`);
      }
      await saveUserAuthorization(userId, account, q.query.installation_id);
      return reply.redirect(`${config.WEB_URL}/my-project/${state.repoId}?github=select`);
    },
  );

  r.get(
    "/api/me/github",
    {
      config: { routeAccessPolicy: { kind: "authenticated" as const } },
      preHandler: requireAuth,
      schema: {
        summary: "Read my linked GitHub account",
        description:
          "Whether the GitHub App is configured and the GitHub login linked to the account.",
      },
    },
    async (q) => ({
      configured: config.githubConfigured,
      login: (await accountStatus(actor(q.userId)))?.login ?? null,
    }),
  );

  r.post(
    "/api/me/github/authorize",
    {
      ...member,
      schema: {
        summary: "Start linking my GitHub account",
        description:
          "Returns the GitHub authorization URL, bound by a signed 15-minute state to the member. The callback stores the GitHub login so commits and pull requests are ranked under the member's name.",
      },
    },
    async (q) => {
      assertGithubConfigured();
      return { url: authorizeUrl(signState(actor(q.userId), null)) };
    },
  );

  r.delete(
    "/api/me/github",
    {
      ...member,
      schema: {
        summary: "Unlink my GitHub account",
        description:
          "Removes the linked GitHub login and the installations verified with it; audited.",
      },
    },
    async (q) => {
      await unlinkAccount(actor(q.userId));
      return { ok: true };
    },
  );

  r.get(
    "/api/me/projects/:id/github/repos",
    {
      ...member,
      preHandler: requireAuth,
      schema: {
        params,
        summary: "List linkable GitHub repositories",
        description:
          "Repositories, private ones included, that the member granted the GitHub App access to.",
      },
    },
    async (q) => {
      assertGithubConfigured();
      const userId = actor(q.userId);
      await assertActiveMember(userId, q.params.id);
      return { repos: await selectableRepos(userId) };
    },
  );

  r.put(
    "/api/me/projects/:id/github/repo",
    {
      ...member,
      schema: {
        params,
        body: z.object({ githubRepoId: z.number().int().positive() }),
        summary: "Link a GitHub repository to a project",
        description:
          "Links one repository the member granted the App access to. Fills the project's GitHub URL when empty, audits the change and seeds commits and pull requests in the background. A repository can belong to one project.",
      },
    },
    async (q) => {
      assertGithubConfigured();
      const userId = actor(q.userId);
      await assertActiveMember(userId, q.params.id);
      const link = await linkRepo(userId, q.params.id, q.body.githubRepoId);
      await runBackfill(q.params.id);
      return { fullName: link.fullName, isPrivate: link.isPrivate };
    },
  );

  r.delete(
    "/api/me/projects/:id/github",
    {
      ...member,
      schema: {
        params,
        summary: "Unlink a project's GitHub repository",
        description: "Removes the link and the commits and pull requests tracked for it; audited.",
      },
    },
    async (q) => {
      const userId = actor(q.userId);
      await assertActiveMember(userId, q.params.id);
      await unlinkRepo(userId, q.params.id);
      return { ok: true };
    },
  );

  r.get(
    "/api/tv/github",
    {
      config: { routeAccessPolicy: { kind: "public", anonymousCategory: "public-tv" } },
      schema: {
        summary: "Read the GitHub activity ranking",
        description:
          "Top committers and pull-request authors, per person and per project team, counted inside the hacking window. Shared cache, 15 s.",
      },
    },
    () => sharedCache("tv", "github", 15, leaderboard),
  );
}

/** Webhook lives in a scope that keeps the raw body for signature verification. */
export async function registerGithubWebhook(app: FastifyInstance) {
  await app.register(async (scoped) => {
    scoped.addContentTypeParser("application/json", { parseAs: "buffer" }, (_req, body, done) =>
      done(null, body),
    );
    scoped.post(
      "/api/github/webhook",
      {
        config: { routeAccessPolicy: { kind: "token", policy: "github-webhook-signature" } },
        schema: {
          summary: "GitHub App webhook",
          description:
            "Receives push, pull_request and installation events. The X-Hub-Signature-256 HMAC over the raw body is the only credential; events for repositories that are not linked are ignored.",
        },
      },
      async (req, reply) => {
        const raw = req.body as Buffer;
        if (!verifyWebhookSignature(raw, req.headers["x-hub-signature-256"] as string | undefined))
          throw new UnauthorizedError("Invalid webhook signature");
        const event = req.headers["x-github-event"];
        const payload = JSON.parse(raw.toString("utf8")) as WebhookPayload;
        if (event === "installation" && payload.action === "deleted")
          await removeInstallation(Number(payload.installation.id));
        else if (event === "push" || event === "pull_request") {
          const repoId = await repoForGithubId(Number(payload.repository?.id));
          if (repoId != null) {
            if (event === "push") {
              await recordCommits(
                pool,
                repoId,
                (payload.commits ?? []).map((c) => ({
                  sha: c.id,
                  login: c.author?.username ?? null,
                  at: c.timestamp,
                })),
              );
            } else {
              const pr = payload.pull_request;
              if (!pr) return reply.code(202).send({ ok: true });
              await recordPull(pool, repoId, {
                number: pr.number,
                login: pr.user?.login ?? null,
                state: pr.state,
                mergedAt: pr.merged_at,
                openedAt: pr.created_at,
              });
            }
          }
        }
        return reply.code(202).send({ ok: true });
      },
    );
  });
}
