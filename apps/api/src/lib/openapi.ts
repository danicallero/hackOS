import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import type { FastifyInstance } from "fastify";
import { jsonSchemaTransform, jsonSchemaTransformObject } from "fastify-type-provider-zod";
import { config } from "../config.js";
import { isProbePath, pathMatchesPrefix } from "./request-path.js";
import { openApiSecurityForPolicy } from "./route-policy.js";

// One entry per tag `docsTagFor` can return. Keeps /documentation's sidebar
// grouped and readable instead of an alphabetical dump of every route.
const TAG_DESCRIPTIONS: Record<string, string> = {
  foundation: "Liveness, shared infrastructure and realtime transport.",
  public: "Unauthenticated read-only endpoints for the public event site.",
  auth: "Better Auth session lifecycle (sign up/in/out, verification, password reset).",
  identity: "Users, invites, permissions and the caller's own profile (H1–H10).",
  applications: "Application forms, review, decisions and confirmations (H11–H15).",
  "form-libraries":
    "Question-owned catalogues, participant proposals and organizer curation (H11, H16).",
  projects:
    "Native project drafts, submissions, gallery and queue-facing project records (H16–H21, H44–H46).",
  challenges: "Challenge details, visibility and judging configuration (H44–H46, H49).",
  enterprises: "Enterprise records, memberships and sponsor configuration (H9, H43–H46).",
  queue:
    "Judging queues, shared queue groups, room assignment, TV displays and realtime streams (H29–H46).",
  logistics:
    "Accreditation, badge/presence scanning, schedule, Wallet and on-site activities (H22–H28, H48–H49, H59).",
  event: "Event identity, timing, venue and admission settings (H10, H45, H47).",
  exports: "Application and operational data exports (H54, H56).",
  directory: "Opt-in public participant profiles and their shared details (#934).",
  diary: "The attendee's saved people and sponsor stands (#935).",
  helpdesk: "Helper profiles, knowledge topics, help requests and coverage (H61–H67).",
  reports: "Attendee content reports and the organiser moderation inbox (H18).",
  certificates:
    "Attendance certificates, their policy, issue, revocation and verification (#1083).",
  "live-activities": "Participant and staff Live Activities / Live Updates (#966).",
  statistics: "Configurable event statistics and their access controls (H27).",
  sponsors: "Sponsor content, including the sponsor FAQ (H43–H45, H58).",
  notifications: "Announcements and the notification outbox (H47–H51).",
  telemetry: "Low-cardinality browser observations for event-day realtime load (H38, #544).",
  audit: "Read access to the audit trail for sensitive mutations (H53).",
  api: "API routes that do not yet have a domain tag.",
};

/** OpenAPI tag for a route template; the first matching prefix family wins. */
function docsTagFor(url: string): keyof typeof TAG_DESCRIPTIONS {
  if (isProbePath(url)) return "foundation";
  if (pathMatchesPrefix(url, "/api/realtime")) return "foundation";
  if (pathMatchesPrefix(url, "/api/public")) return "public";
  if (pathMatchesPrefix(url, "/api/auth")) return "auth";
  if (pathMatchesPrefix(url, "/api/form-libraries")) return "form-libraries";
  if (["/api/reports", "/api/content-reports"].some((prefix) => pathMatchesPrefix(url, prefix)))
    return "reports";

  if (
    pathMatchesPrefix(url, "/api/certificates") ||
    pathMatchesPrefix(url, "/api/me/certificates") ||
    (url.startsWith("/api/users/") && url.endsWith("/certificates"))
  )
    return "certificates";
  if (pathMatchesPrefix(url, "/api/me/diary")) return "diary";
  if (pathMatchesPrefix(url, "/api/me/helper-profile")) return "helpdesk";
  if (pathMatchesPrefix(url, "/api/me/live-activities")) return "live-activities";
  if (pathMatchesPrefix(url, "/api/me/projects")) return "projects";
  if (
    ["/api/me/notifications", "/api/me/notification-preferences", "/api/me/push-tokens"].some(
      (prefix) => pathMatchesPrefix(url, prefix),
    )
  )
    return "notifications";
  if (
    ["/api/me/applications", "/api/me/responses"].some((prefix) => pathMatchesPrefix(url, prefix))
  )
    return "applications";
  if (pathMatchesPrefix(url, "/api/me/public-profile") || url.includes("/public-profile"))
    return "directory";
  if (
    ["/api/me/logistics", "/api/me/meal-plan", "/api/me/ticket", "/api/me/wallet"].some((prefix) =>
      pathMatchesPrefix(url, prefix),
    )
  )
    return "logistics";
  if (/^\/api\/users\/[^/]+\/(?:applications|responses)(?:\/|$)/.test(url)) return "applications";
  if (/^\/api\/users\/[^/]+\/projects(?:\/|$)/.test(url)) return "projects";
  if (/^\/api\/users\/[^/]+\/enterprises(?:\/|$)/.test(url)) return "sponsors";
  if (/^\/api\/users\/[^/]+\/(?:activity|meal-plan|ticket)(?:\/|$)/.test(url)) return "logistics";
  if (/^\/api\/enterprises\/[^/]+\/(?:assignable-rooms|queue-groups)(?:\/|$)/.test(url))
    return "queue";
  if (pathMatchesPrefix(url, "/api/event/wallet")) return "logistics";

  if (
    [
      "/api/me",
      "/api/users",
      "/api/permissions",
      "/api/admin/review-fixtures",
      "/api/invites",
      "/api/profile",
      "/api/roles",
      "/api/role-grant-rules",
      "/api/role-templates",
      "/api/unverified-account-removal",
    ].some((prefix) => pathMatchesPrefix(url, prefix))
  )
    return "identity";

  if (
    ["/api/applications", "/api/responses", "/api/files"].some((prefix) =>
      pathMatchesPrefix(url, prefix),
    )
  )
    return "applications";
  if (
    ["/api/projects", "/api/repos", "/api/github"].some((prefix) => pathMatchesPrefix(url, prefix))
  )
    return "projects";
  if (pathMatchesPrefix(url, "/api/challenges")) return "challenges";
  if (
    ["/api/queue", "/api/tv", "/api/content", "/api/events"].some((prefix) =>
      pathMatchesPrefix(url, prefix),
    )
  )
    return "queue";
  if (
    [
      "/api/accreditation",
      "/api/activities",
      "/api/degrees",
      "/api/food-intolerances",
      "/api/logistics",
      "/api/presence",
      "/api/scanner",
      "/api/schedule",
      "/api/universities",
      "/api/wallet",
    ].some((prefix) => pathMatchesPrefix(url, prefix))
  )
    return "logistics";
  if (["/api/announcements", "/api/notifications"].some((prefix) => pathMatchesPrefix(url, prefix)))
    return "notifications";
  if (pathMatchesPrefix(url, "/api/telemetry")) return "telemetry";
  if (pathMatchesPrefix(url, "/api/audit")) return "audit";
  if (pathMatchesPrefix(url, "/api/enterprises")) return "enterprises";
  if (pathMatchesPrefix(url, "/api/sponsor-faq")) return "sponsors";
  if (pathMatchesPrefix(url, "/api/diary")) return "diary";
  if (pathMatchesPrefix(url, "/api/helpdesk")) return "helpdesk";
  if (pathMatchesPrefix(url, "/api/event")) return "event";
  if (pathMatchesPrefix(url, "/api/exports")) return "exports";
  if (pathMatchesPrefix(url, "/api/directory")) return "directory";
  if (pathMatchesPrefix(url, "/api/statistics")) return "statistics";
  if (pathMatchesPrefix(url, "/api/live-activities")) return "live-activities";
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

  addAuthOperation(paths, "/api/auth/list-sessions", "get", {
    tags: ["auth"],
    summary: "List my signed-in devices",
    description:
      "Every active session of the authenticated user (token, user agent, last activity), for the Active devices list in Profile and account.",
    security: [{ sessionToken: [] }, { bearerToken: [] }],
  });

  addAuthOperation(paths, "/api/auth/revoke-session", "post", {
    tags: ["auth"],
    summary: "Sign out one device",
    description: "Revokes one of the authenticated user's sessions, identified by its `token`.",
    security: [{ sessionToken: [] }, { bearerToken: [] }],
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            required: ["token"],
            properties: { token: { type: "string" } },
          },
        },
      },
    },
  });

  addAuthOperation(paths, "/api/auth/revoke-other-sessions", "post", {
    tags: ["auth"],
    summary: "Sign out every other device",
    description: "Revokes all of the authenticated user's sessions except the current one.",
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

  addAuthOperation(paths, "/api/auth/change-password", "post", {
    tags: ["auth"],
    summary: "Change password",
    description:
      "Change the authenticated user's password after verifying the current password. Revokes every other session and replaces the current session.",
    security: [{ sessionToken: [] }, { bearerToken: [] }],
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            required: ["currentPassword", "newPassword", "revokeOtherSessions"],
            properties: {
              currentPassword: { type: "string" },
              newPassword: { type: "string", minLength: 8 },
              revokeOtherSessions: { type: "boolean", enum: [true] },
            },
          },
        },
      },
    },
  });

  addAuthOperation(paths, "/api/auth/verify-email", "get", {
    tags: ["auth"],
    summary: "Verify email",
    description:
      "Read-only scanner-safe endpoint; returns 405. The web verification page submits the token deliberately to POST /api/auth/verify-email/confirm.",
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

  addAuthOperation(paths, "/api/auth/verify-email/confirm", "post", {
    tags: ["auth"],
    summary: "Confirm email after user action",
    description:
      "Accepts the verification page's form POST from the configured web origin, invokes Better Auth's verification handler, and redirects to the safe callback. The token is sent in the body, never in the request URL.",
    security: [],
  });

  openapiObject.paths = paths;
  return openapiObject;
}

/** Serve the generated OpenAPI document and Swagger UI at /documentation. */
/** `version` is read by the caller: `package.json` is a different relative path from `src/` and from the bundled `dist/`. */
export async function registerApiDocs(app: FastifyInstance, version: string): Promise<void> {
  await app.register(swagger, {
    openapi: {
      info: {
        title: "hackOS API",
        version,
        description:
          "Hackathon management API. Routes are grouped by domain below; " +
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
}
