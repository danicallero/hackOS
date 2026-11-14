import { createRequire } from "node:module";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import Fastify, { type FastifyInstance } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { config } from "./config.js";
import { registerErrorHandler } from "./lib/error-handler.js";
import { registerHealthRoutes } from "./lib/health.routes.js";
import {
  registerAdmissionHooks,
  registerMutationRefreshHook,
  registerReviewFixtureLogHook,
} from "./lib/http-hooks.js";
import { idempotencyOnSend } from "./lib/idempotency.js";
import { registerApiDocs } from "./lib/openapi.js";
import { pathOf } from "./lib/request-path.js";
import { registerRoutePolicyInfrastructure } from "./lib/route-policy.js";
import { registerSessionInvalidations } from "./lib/session-invalidation.js";
import { registerModules } from "./modules/index.js";
import { authContextPlugin } from "./plugins/auth-context.js";
import { clientFloorPlugin } from "./plugins/client-floor.js";
import { maintenancePlugin } from "./plugins/maintenance.js";
import { requestContextPlugin } from "./plugins/request-context.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

export type App = FastifyInstance;

export async function buildApp(): Promise<App> {
  const app = Fastify({
    trustProxy: config.trustProxy,
    logger: config.isTest
      ? false
      : {
          level: config.LOG_LEVEL,
          transport: config.isProd ? undefined : { target: "pino-pretty" },
        },
  }).withTypeProvider<ZodTypeProvider>();

  // Every application route is part of the machine-readable access ledger.
  // Startup fails closed if a route is added without an explicit policy; the
  // Better Auth generated catch-all is the sole narrow exemption.
  registerRoutePolicyInfrastructure(app);
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Public catalogues remain anonymously embeddable. Viewer-dependent project
  // and winner projections also accept credentials from configured app origins.
  // Every other route keeps the configured credentialed-origin boundary.
  const corsOrigins = config.CORS_ORIGINS.split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  const privateCors = {
    origin: config.isProd ? (corsOrigins.length > 0 ? corsOrigins : false) : true,
    credentials: true,
    // @fastify/cors defaults to GET,HEAD,POST only — the web app also uses
    // PATCH (profile, H7), PUT and DELETE (permissions, H8), so they must be
    // allowed explicitly or the browser preflight blocks them.
    methods: ["GET", "HEAD", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    // Custom request headers the app sends (idempotency on critical mutations).
    // X-Edition carries the viewed edition (docs/multi-edition-plan.md).
    allowedHeaders: ["content-type", "idempotency-key", "x-edition"],
    // Response headers the browser must be able to read cross-origin: rate
    // limit backoff (H3), idempotent-replay signalling, per-file export
    // failures (H56) the web client surfaces so staff can act on them, and the
    // original file name of a CV the web viewer downloads from a blob (#935).
    exposedHeaders: [
      "retry-after",
      "idempotency-replayed",
      "x-export-file-failures",
      "content-disposition",
    ],
  };
  await app.register(cors, {
    delegator: (req, done) => {
      const path = pathOf(req.url);
      const requestedMethod = req.headers["access-control-request-method"]?.toUpperCase();
      const method = req.method === "OPTIONS" ? requestedMethod : req.method;
      if (path.startsWith("/api/public/") && (method === "GET" || method === "HEAD")) {
        // H17/H59/H60 public projections may depend on the viewer's audience.
        const origin = req.headers.origin;
        const viewerDependent =
          path === "/api/public/activities" ||
          /^\/api\/public\/projects(?:\/|$)/.test(path) ||
          /^\/api\/public\/challenges\/[^/]+\/winners$/.test(path);
        const appOrigin =
          viewerDependent &&
          (origin === new URL(config.WEB_URL).origin || corsOrigins.includes(origin ?? ""));
        done(null, {
          origin: appOrigin ? origin : "*",
          credentials: appOrigin,
          methods: ["GET", "HEAD", "OPTIONS"],
        });
        return;
      }
      done(null, privateCors);
    },
  });
  // File uploads (H44 sponsor logos) proxied through the API so the browser
  // never needs to reach the object store directly. 5 MB cap on a logo.
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
  await app.register(requestContextPlugin);
  await app.register(clientFloorPlugin);
  await app.register(maintenancePlugin);
  await app.register(authContextPlugin);

  registerAdmissionHooks(app);

  registerReviewFixtureLogHook(app);

  registerSessionInvalidations(app);
  // The API is for the apps, never a search result (#1083: certificate PDFs are served here).
  app.addHook("onSend", async (_req, reply) => {
    reply.header("x-robots-tag", "noindex, nofollow, noarchive");
  });
  app.addHook("onSend", idempotencyOnSend);
  registerMutationRefreshHook(app);

  await registerApiDocs(app, pkg.version);

  registerErrorHandler(app);
  // Body-less actions (cancel, release, resolve) from clients that still declare
  // a JSON content type: an empty body is no body, not a malformed one. Dropping
  // the header before parsing leaves every scoped body parser untouched.
  app.addHook("onRequest", async (req) => {
    const length = req.headers["content-length"];
    if (
      (length === undefined || length === "0") &&
      req.headers["transfer-encoding"] === undefined &&
      req.headers["content-type"]?.startsWith("application/json")
    ) {
      delete req.headers["content-type"];
    }
  });

  registerHealthRoutes(app);

  await registerModules(app);

  return app;
}
