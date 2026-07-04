import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify, { type FastifyInstance } from "fastify";
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
import { valkey } from "./lib/valkey.js";
import { registerModules } from "./modules/index.js";
import { authContextPlugin } from "./plugins/auth-context.js";

export type App = FastifyInstance;

const PUBLIC_OPERATIONS = new Set([
  "GET /healthz",
  "GET /api/announcements/public",
  "GET /api/tv/mode",
  "GET /api/tv/rooms",
  "GET /api/stream/queue",
  "GET /api/stream/tv",
]);

function docsTagFor(url: string): string {
  if (url === "/healthz") return "foundation";
  if (url.startsWith("/api/auth/")) return "auth";
  if (url.startsWith("/api/me") || url.startsWith("/api/users") || url.startsWith("/api/permissions"))
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

function needsAuth(url: string, method: string): boolean {
  if (url.startsWith("/api/auth/")) return false;
  return !PUBLIC_OPERATIONS.has(`${method} ${url}`);
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
  });
  await app.register(authContextPlugin);
  app.addHook("onSend", idempotencyOnSend);

  await app.register(swagger, {
    openapi: {
      info: {
        title: "hackOS API",
        version: "0.0.0",
        description: "Hackathon management API",
      },
      servers: [],
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
      const method =
        typeof input.route?.method === "string"
          ? input.route.method
          : Array.isArray(input.route?.method)
            ? String(input.route.method[0] ?? "GET")
            : "GET";
      const tag = docsTagFor(transformed.url);

      if (!("tags" in schema)) schema.tags = [tag];
      if (!("summary" in schema)) schema.summary = `${method} ${transformed.url}`;
      if (needsAuth(transformed.url, method) && !("security" in schema)) {
        schema.security = [{ sessionToken: [] }, { bearerToken: [] }];
      }

      return { ...transformed, schema };
    },
    transformObject: jsonSchemaTransformObject,
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

  app.get("/healthz", async () => {
    await pool.query("SELECT 1");
    await valkey.ping();
    return { status: "ok" };
  });

  await registerModules(app);

  return app;
}
