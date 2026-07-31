import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { config } from "../config.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Authenticated user id, or null. Filled from the Better Auth session. */
    userId: number | null;
    /** Request-scoped PostgreSQL capability resolution (H8). */
    effectiveCapabilities?: Promise<Set<string>>;
  }
}

/**
 * Decorates every request with `userId`. The real resolution — Better Auth
 * session cookie/bearer → user id — is wired by the identity module (H1-H10),
 * which overrides `resolveUserId`. Until then (and always, in NODE_ENV=test)
 * the `x-test-user-id` header lets modules and tests exercise
 * capability-guarded routes without a full auth stack.
 */
export type UserIdResolver = (req: import("fastify").FastifyRequest) => Promise<number | null>;

let resolveUserId: UserIdResolver = async () => null;

/** Called once by the identity module at startup to plug in Better Auth. */
export function setUserIdResolver(resolver: UserIdResolver): void {
  resolveUserId = resolver;
}

export const authContextPlugin = fp(async (app: FastifyInstance) => {
  app.decorateRequest("userId", null);
  app.decorateRequest("effectiveCapabilities", undefined);
  app.addHook("onRequest", async (req) => {
    if (config.isTest) {
      const testHeader = req.headers["x-test-user-id"];
      if (typeof testHeader === "string" && testHeader !== "") {
        req.userId = Number(testHeader);
        return;
      }
    }
    req.userId = await resolveUserId(req);
  });
});
