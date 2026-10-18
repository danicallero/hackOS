import type { FastifyInstance } from "fastify";
import { registerGithubRoutes, registerGithubWebhook } from "./routes.js";

/** GitHub App repo linking and event activity ranking. */
export async function registerGithubModule(app: FastifyInstance): Promise<void> {
  registerGithubRoutes(app);
  await registerGithubWebhook(app);
}
