import { createRequire } from "node:module";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import {
  jsonSchemaTransform,
  jsonSchemaTransformObject,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { config } from "./config.js";
import { pool } from "./db/pool.js";
import { AppError } from "./lib/errors.js";
import { idempotencyOnSend } from "./lib/idempotency.js";
import { cacheJson, invalidateReadCache, readCachedJson, readCacheKey } from "./lib/read-cache.js";
import { openApiSecurityForPolicy, registerRoutePolicyInfrastructure } from "./lib/route-policy.js";
import { broadcast } from "./lib/sse.js";
import { valkey } from "./lib/valkey.js";
import { registerModules } from "./modules/index.js";
import { authContextPlugin } from "./plugins/auth-context.js";

export type App = FastifyInstance;

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

// One entry per tag `docsTagFor` can return. Keeps /documentation's sidebar
// grouped and readable instead of an alphabetical dump of every route.
const TAG_DESCRIPTIONS: Record<string, string> = {
  foundation: "Liveness and infrastructure — nothing story-specific.",
  public: "Unauthenticated read-only endpoints for the public event site.",
  auth: "Better Auth session lifecycle (sign up/in/out, verification, password reset).",
  identity: "Users, invites, permissions and the caller's own profile (H1–H10).",
  applications: "Application forms, review, decisions and confirmations (H11–H15).",
  projects: "Devpost import/sync and project/repo records (H16–H21, H44–H46).",
  queue: "Judging queue, TV displays and their realtime streams (H29–H42).",
  logistics: "Accreditation, badge/presence scanning and on-site activities (H22–H27).",
  notifications: "Announcements and the notification outbox (H47–H51).",
  audit: "Read access to the audit trail for sensitive mutations (H53).",
  api: "Everything not yet grouped under a more specific tag above.",
};

function logSoftFailure(req: FastifyRequest, err: unknown, message: string): void {
  req.log.warn({ err, method: req.method, url: req.url }, message);
}

function docsTagFor(url: string): keyof typeof TAG_DESCRIPTIONS {
  if (url === "/healthz") return "foundation";
  if (url.startsWith("/api/public/")) return "public";
  if (url.startsWith("/api/auth/")) return "auth";
  if (
    url.startsWith("/api/me") ||
    url.startsWith("/api/users") ||
    url.startsWith("/api/permissions")
  )
    return "identity";
  if (url.startsWith("/api/invites") || url.startsWith("/api/profile")) return "identity";
  if (url.startsWith("/api/applications")) return "applications";
  if (url.startsWith("/api/devpost") || url.startsWith("/api/repos")) return "projects";
  if (url.startsWith("/api/queue") || url.startsWith("/api/tv") || url.startsWith("/api/stream"))
    return "queue";
  if (url.startsWith("/api/accreditation") || url.startsWith("/api/activities")) return "logistics";
  if (url.startsWith("/api/announcements") || url.startsWith("/api/notifications"))
    return "notifications";
  if (url.startsWith("/api/audit")) return "audit";
  return "api";
}

function addAuthOperation(
  paths: Record<string, Record<string, unknown>>,
  path: string,
  method: "get" | "post",
  operation: Record<string, unknown>,
): void {
  if (!paths[path]) paths[path] = {};
  if (paths[path][method]) return;
  paths[path][method] = operation;
}

function withAuthDocs(openapiObject: Record<string, unknown>): Record<string, unknown> {
  const paths = ((openapiObject.paths as Record<string, Record<string, unknown>> | undefined) ??
    {}) as Record<string, Record<string, unknown>>;

  delete paths["/api/auth/{*}"];

  addAuthOperation(paths, "/api/auth/sign-up/email", "post", {
    tags: ["auth"],
    summary: "Sign up (email/password)",
    description: "Create an account and start an auth session.",
    security: [],
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            required: ["email", "password", "name", "surname"],
            properties: {
              email: { type: "string", format: "email" },
              password: { type: "string", minLength: 8 },
              name: { type: "string" },
              surname: { type: "string" },
              language: { type: "string", enum: ["en", "es", "gl"] },
            },
          },
        },
      },
    },
  });

  addAuthOperation(paths, "/api/auth/sign-in/email", "post", {
    tags: ["auth"],
    summary: "Sign in (email/password)",
    description: "Authenticate and set the session cookie.",
    security: [],
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            required: ["email", "password"],
            properties: {
              email: { type: "string", format: "email" },
              password: { type: "string" },
            },
          },
        },
      },
    },
  });

  addAuthOperation(paths, "/api/auth/sign-out", "post", {
    tags: ["auth"],
    summary: "Sign out",
    description: "Invalidate the current session.",
  });

  addAuthOperation(paths, "/api/auth/get-session", "get", {
    tags: ["auth"],
    summary: "Get current session",
    description: "Resolve the active session from cookies/headers.",
    security: [{ sessionToken: [] }, { bearerToken: [] }],
  });

  addAuthOperation(paths, "/api/auth/request-password-reset", "post", {
    tags: ["auth"],
    summary: "Request password reset",
    description: "Queue a reset email (enumeration-safe response).",
    security: [],
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            required: ["email"],
            properties: { email: { type: "string", format: "email" } },
          },
        },
      },
    },
  });

  addAuthOperation(paths, "/api/auth/reset-password", "post", {
    tags: ["auth"],
    summary: "Reset password",
    description: "Reset password using a token from reset email.",
    security: [],
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            required: ["token", "newPassword"],
            properties: {
              token: { type: "string" },
              newPassword: { type: "string", minLength: 8 },
            },
          },
        },
      },
    },
  });

  addAuthOperation(paths, "/api/auth/verify-email", "get", {
    tags: ["auth"],
    summary: "Verify email",
    description: "Confirm email ownership with verification token.",
    security: [],
    parameters: [
      {
        name: "token",
        in: "query",
        required: true,
        schema: { type: "string" },
      },
    ],
  });

  openapiObject.paths = paths;
  return openapiObject;
}

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
  registerRoutePolicyInfrastructure(app, { enforce: true });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // In production, restrict CORS to the configured origins (credentials are
  // sent, so reflecting arbitrary origins would be unsafe). In dev, reflect
  // any origin for convenience.
  const corsOrigins = config.CORS_ORIGINS.split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  await app.register(cors, {
    origin: config.isProd ? (corsOrigins.length > 0 ? corsOrigins : false) : true,
    credentials: true,
    // @fastify/cors defaults to GET,HEAD,POST only — the web app also uses
    // PATCH (profile, H7), PUT and DELETE (permissions, H8), so they must be
    // allowed explicitly or the browser preflight blocks them.
    methods: ["GET", "HEAD", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    // Custom request headers the app sends (idempotency on critical mutations).
    allowedHeaders: ["content-type", "idempotency-key"],
    // Response headers the browser must be able to read cross-origin: rate
    // limit backoff (H3) and idempotent-replay signalling.
    exposedHeaders: ["retry-after", "idempotency-replayed"],
  });
  // File uploads (H44 sponsor logos) proxied through the API so the browser
  // never needs to reach the object store directly. 5 MB cap on a logo.
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
  await app.register(authContextPlugin);
  app.addHook("onSend", idempotencyOnSend);
  app.addHook("preHandler", async (req, reply) => {
    try {
      const key = await readCacheKey(req);
      if (!key) return;
      req.readCacheKey = key;
      const cached = await readCachedJson(key);
      if (cached !== null) {
        reply.header("x-read-cache", "HIT");
        return reply.send(cached);
      }
      reply.header("x-read-cache", "MISS");
    } catch (err) {
      // Cache availability must never prevent a normal API read.
      logSoftFailure(req, err, "read cache lookup failed");
    }
  });
  app.addHook("preSerialization", async (req, reply, payload) => {
    if (reply.statusCode >= 300) return payload;
    try {
      await cacheJson(req.readCacheKey, payload);
    } catch (err) {
      logSoftFailure(req, err, "read cache write failed");
    }
    return payload;
  });
  app.addHook("onResponse", async (req, reply) => {
    // This is the catch-all synchronization contract: a successful mutation
    // emits an intentionally payload-free event so it cannot expose data from
    // an endpoint to an unrelated open window. Domain streams still carry
    // their specific events for consumers that can update more selectively.
    if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method) && reply.statusCode < 300) {
      try {
        await invalidateReadCache();
        await broadcast(SSE_TOPICS.GLOBAL, EVENTS.DATA_CHANGED, { at: new Date().toISOString() });
      } catch (err) {
        logSoftFailure(req, err, "global SSE broadcast failed");
      }
    }
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: "hackOS API",
        version: pkg.version,
        description:
          "Hackathon management API. Routes are grouped by story area below; " +
          "each schema is the single source of truth for both validation and " +
          "this document — see CLAUDE.md's documentation-sync rule before " +
          "adding a route without a summary/description.",
      },
      servers: [{ url: config.BETTER_AUTH_URL, description: "This deployment" }],
      tags: Object.entries(TAG_DESCRIPTIONS).map(([name, description]) => ({
        name,
        description,
      })),
      components: {
        securitySchemes: {
          sessionToken: {
            type: "apiKey",
            in: "cookie",
            name: "session_token",
            description: "Session cookie from /api/auth/sign-in/email",
          },
          bearerToken: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "token",
            description: "Optional token auth for non-browser clients",
          },
        },
      },
    },
    transform: (input) => {
      const transformed = jsonSchemaTransform(input);
      const schema = (transformed.schema ?? {}) as Record<string, unknown>;
      if (transformed.url === "/api/auth/{*}" || transformed.url === "/api/auth/*") {
        schema.hide = true;
        return { ...transformed, schema };
      }
      const method =
        typeof input.route?.method === "string"
          ? input.route.method
          : Array.isArray(input.route?.method)
            ? String(input.route.method[0] ?? "GET")
            : "GET";
      const tag = docsTagFor(transformed.url);

      if (!("tags" in schema)) schema.tags = [tag];
      if (!("summary" in schema)) schema.summary = `${method} ${transformed.url}`;
      if (!("description" in schema)) {
        // Flags routes that shipped without a hand-written description, so
        // it's obvious in /documentation rather than silently blank — fix by
        // adding `description` to the route's schema (CLAUDE.md doc rule).
        schema.description = "No description yet — add one to this route's schema.";
      }
      const policy = input.route?.config?.routeAccessPolicy;
      if (policy) {
        schema.security = openApiSecurityForPolicy(policy);
      }

      return { ...transformed, schema };
    },
    transformObject: (input) => withAuthDocs(jsonSchemaTransformObject(input)),
  });
  await app.register(swaggerUi, {
    routePrefix: "/documentation",
    uiConfig: { persistAuthorization: true },
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      if (err.statusCode === 429 && "retryAfterSeconds" in err && err.retryAfterSeconds) {
        reply.header("retry-after", String(err.retryAfterSeconds));
      }
      return reply.code(err.statusCode).send({
        error: { code: err.code, message: err.message, details: err.details ?? undefined },
      });
    }
    if (typeof err === "object" && err !== null && "validation" in err) {
      return reply.code(400).send({
        error: {
          code: "validation",
          message: (err as { message?: string }).message ?? "Invalid request",
        },
      });
    }
    req.log.error(err);
    return reply.code(500).send({
      error: { code: "internal", message: "Internal server error" },
    });
  });

  app.get(
    "/healthz",
    {
      config: {
        routeAccessPolicy: { kind: "public", anonymousCategory: "health" },
      },
      schema: {
        description:
          "Liveness/readiness probe. Round-trips Postgres and Valkey; returns " +
          "non-200 if either is unreachable. Used by container healthchecks.",
      },
    },
    async () => {
      await pool.query("SELECT 1");
      await valkey.ping();
      return { status: "ok" };
    },
  );

  await registerModules(app);

  return app;
}
