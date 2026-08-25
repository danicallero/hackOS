import { ALL_CAPABILITIES, type Capability } from "@hackos/shared/capabilities";
import type { FastifyInstance, FastifyRequest, RouteOptions } from "fastify";
import { requireVerifiedEmail } from "./email-verification.js";

/**
 * H1's verification boundary. `caller` is enforced by the shared
 * preHandler; `target` is for session-less token protocols whose service must
 * check the user named by the token; `none` is reserved for account/security
 * lifecycle, read-only POSTs, and reversible preparation work.
 */
export type EmailVerificationRequirement = "caller" | "target" | "none";

interface RouteAccessOptions {
  emailVerification?: EmailVerificationRequirement;
}

/**
 * Machine-readable API access contract (H8, H53).  Route modules declare one
 * of these in `config.routeAccessPolicy`; it is both the audit ledger source
 * and the input for the shared authorization pre-handlers.
 */
export type AnonymousAccessCategory =
  | "health"
  | "metrics"
  | "public-content"
  | "public-announcement"
  | "public-tv"
  | "public-invalidation"
  | "telemetry";

export type RouteAccessPolicy = (
  | { kind: "public"; anonymousCategory: AnonymousAccessCategory }
  | { kind: "token"; policy: string }
  | { kind: "authenticated" }
  | {
      kind: "capability";
      capability?: Capability;
      allOf?: readonly Capability[];
      anyOf?: readonly Capability[];
    }
  | {
      kind: "contextual";
      policy: string;
      /**
       * Omit for collection/global policies whose resolver derives context
       * from the authenticated caller rather than a single route resource.
       */
      resource?: ContextualResourceLocator;
    }
) &
  RouteAccessOptions;

/** Identifies the route input a contextual resolver must bind to. */
export interface ContextualResourceLocator {
  /** The parameter/query/body location holding the resource identifier. */
  source: "params" | "query" | "body";
  /** Dot-separated field path within that location. */
  field: string;
}

/**
 * Named relationship policy contract shared by domain modules.  Resolvers
 * must load and cross-check the target resource rather than trusting a parent
 * id supplied separately by the caller.
 */
export interface ContextualPolicyResolver<Resource> {
  readonly name: string;
  resolve(request: FastifyRequest, locator: ContextualResourceLocator): Promise<Resource>;
  authorize(request: FastifyRequest, resource: Resource): Promise<void>;
}

export interface RoutePolicyLedgerRow {
  method: string;
  url: string;
  policy: RouteAccessPolicy;
}

export interface RoutePolicyExemption {
  url: string;
  exemption: "better-auth-generated";
}

declare module "fastify" {
  interface FastifyContextConfig {
    routeAccessPolicy?: RouteAccessPolicy;
    /** Only Better Auth's raw generated handler may use this exemption. */
    routeAccessPolicyExemption?: "better-auth-generated";
  }

  interface FastifyInstance {
    routePolicyLedger: RoutePolicyLedgerRow[];
    routePolicyExemptions: RoutePolicyExemption[];
  }
}

function isApplicationRoute(route: RouteOptions): boolean {
  return route.url === "/healthz" || route.url === "/metrics" || route.url.startsWith("/api/");
}

function validatePolicy(policy: RouteAccessPolicy, route: RouteOptions): void {
  if (!policy || typeof policy !== "object" || !("kind" in policy)) {
    throw new Error(`Route ${String(route.method)} ${route.url} has invalid policy metadata`);
  }
  if (
    policy.emailVerification !== undefined &&
    !["caller", "target", "none"].includes(policy.emailVerification)
  ) {
    throw new Error(
      `Route ${String(route.method)} ${route.url} has an invalid email-verification requirement`,
    );
  }
  if (
    policy.emailVerification === "caller" &&
    (policy.kind === "public" || policy.kind === "token")
  ) {
    throw new Error(
      `Route ${String(route.method)} ${route.url} cannot require caller email verification for ${policy.kind} access`,
    );
  }
  if (policy.emailVerification === "target" && policy.kind !== "token") {
    throw new Error(
      `Route ${String(route.method)} ${route.url} can require target email verification only for token access`,
    );
  }
  if (policy.kind === "public") {
    if (
      ![
        "health",
        "metrics",
        "public-content",
        "public-announcement",
        "public-tv",
        "public-invalidation",
        "telemetry",
      ].includes(policy.anonymousCategory)
    ) {
      throw new Error(`Route ${String(route.method)} ${route.url} has an invalid public category`);
    }
    return;
  }

  if (policy.kind === "token") {
    if (typeof policy.policy !== "string" || policy.policy.trim().length === 0) {
      throw new Error(`Route ${String(route.method)} ${route.url} has an empty token policy`);
    }
    return;
  }

  if (policy.kind === "authenticated") return;

  if (policy.kind === "capability") {
    if (
      (policy.capability !== undefined && typeof policy.capability !== "string") ||
      (policy.allOf !== undefined && !Array.isArray(policy.allOf)) ||
      (policy.anyOf !== undefined && !Array.isArray(policy.anyOf)) ||
      [...(policy.allOf ?? []), ...(policy.anyOf ?? [])].some(
        (capability) => typeof capability !== "string",
      )
    ) {
      throw new Error(`Route ${String(route.method)} ${route.url} has malformed capability policy`);
    }
    const alternatives = [policy.capability, policy.allOf, policy.anyOf].filter(
      (value) => value !== undefined,
    );
    if (alternatives.length !== 1) {
      throw new Error(
        `Route ${String(route.method)} ${route.url} must declare exactly one capability, allOf, or anyOf policy`,
      );
    }
    if (
      (policy.allOf?.length ?? 0) === 0 &&
      (policy.anyOf?.length ?? 0) === 0 &&
      !policy.capability
    ) {
      throw new Error(`Route ${String(route.method)} ${route.url} has an empty capability policy`);
    }
    const declared = policy.capability
      ? [policy.capability]
      : [...(policy.allOf ?? []), ...(policy.anyOf ?? [])];
    const unknown = declared.filter((capability) => !ALL_CAPABILITIES.includes(capability));
    if (unknown.length > 0) {
      throw new Error(
        `Route ${String(route.method)} ${route.url} declares unknown capability ${unknown.join(", ")}`,
      );
    }
    return;
  }

  if (policy.kind === "contextual") {
    if (typeof policy.policy !== "string" || policy.policy.trim().length === 0) {
      throw new Error(`Route ${String(route.method)} ${route.url} has an empty contextual policy`);
    }
    if (policy.resource === undefined) return;

    if (
      typeof policy.resource !== "object" ||
      policy.resource === null ||
      !["params", "query", "body"].includes(policy.resource.source)
    ) {
      throw new Error(
        `Route ${String(route.method)} ${route.url} has an invalid contextual resource source`,
      );
    }
    if (
      typeof policy.resource.field !== "string" ||
      policy.resource.field.trim().length === 0 ||
      policy.resource.field.split(".").some((segment) => segment.length === 0)
    ) {
      throw new Error(
        `Route ${String(route.method)} ${route.url} has an invalid contextual resource field`,
      );
    }
    return;
  }

  throw new Error(`Route ${String(route.method)} ${route.url} has unknown policy kind`);
}

/**
 * Adds the route-policy ledger and enforcement hook.  `enforce` is opt-in
 * during the AC-1/AC-2 transition so the foundation can land before each
 * domain has classified its owned routes; production startup must enable it
 * once the complete ledger is registered.  Tests can always opt in directly.
 */
export function registerRoutePolicyInfrastructure(
  app: FastifyInstance,
  { enforce = false }: { enforce?: boolean } = {},
): void {
  const ledger: RoutePolicyLedgerRow[] = [];
  const exemptions: RoutePolicyExemption[] = [];
  app.decorate("routePolicyLedger", ledger);
  app.decorate("routePolicyExemptions", exemptions);
  app.addHook("preHandler", async (request) => {
    const policy = request.routeOptions.config?.routeAccessPolicy;
    if (!policy) return;
    if (emailVerificationForRoute(request.method, policy) === "caller") {
      await requireVerifiedEmail(request);
    }
  });
  app.addHook("onRoute", (route) => {
    if (!isApplicationRoute(route)) return;

    const exemption = route.config?.routeAccessPolicyExemption;
    if (exemption === "better-auth-generated") {
      if (route.url !== "/api/auth/*") {
        throw new Error("The Better Auth route-policy exemption is limited to /api/auth/*");
      }
      if (!exemptions.some((entry) => entry.url === route.url && entry.exemption === exemption)) {
        exemptions.push({ url: route.url, exemption });
      }
      return;
    }

    const policy = route.config?.routeAccessPolicy;
    if (!policy) {
      if (enforce) {
        throw new Error(
          `Application route ${String(route.method)} ${route.url} is missing mandatory RouteAccessPolicy metadata`,
        );
      }
      return;
    }
    validatePolicy(policy, route);
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) ledger.push({ method, url: route.url, policy });
  });
}

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Resolve the effective H1 verification rule for a declared route. Mutating
 * authenticated/capability/contextual routes are protected by default so a
 * newly added event mutation cannot silently bypass H1. Routes that are
 * account lifecycle, read-only despite using POST, or reversible preparation
 * must opt out with `emailVerification: "none"`.
 */
export function emailVerificationForRoute(
  method: string,
  policy: RouteAccessPolicy,
): EmailVerificationRequirement {
  if (policy.emailVerification) return policy.emailVerification;
  if (
    MUTATION_METHODS.has(method.toUpperCase()) &&
    policy.kind !== "public" &&
    policy.kind !== "token"
  ) {
    return "caller";
  }
  return "none";
}

/** Stable, human-readable representation shared by the audit script and tests. */
export function describeRoutePolicy(policy: RouteAccessPolicy, method?: string): string {
  const description = (() => {
    switch (policy.kind) {
      case "public":
        return `public:${policy.anonymousCategory}`;
      case "token":
        return `token:${policy.policy}`;
      case "authenticated":
        return "authenticated";
      case "capability":
        if (policy.capability) return `capability:${policy.capability}`;
        if (policy.allOf) return `capability:allOf(${policy.allOf.join(",")})`;
        return `capability:anyOf(${policy.anyOf?.join(",")})`;
      case "contextual":
        return `contextual:${policy.policy}${policy.resource ? ` (${policy.resource.source}.${policy.resource.field})` : ""}`;
    }
  })();
  const requirement = method ? emailVerificationForRoute(method, policy) : policy.emailVerification;
  const explicitRequirement = policy.emailVerification !== undefined;
  return requirement && (requirement !== "none" || explicitRequirement)
    ? `${description} + email-verification:${requirement}`
    : description;
}

/** OpenAPI's session/bearer marker derives exclusively from route policy. */
export function openApiSecurityForPolicy(policy: RouteAccessPolicy): Array<Record<string, []>> {
  return policy.kind === "public" || policy.kind === "token"
    ? []
    : [{ sessionToken: [] }, { bearerToken: [] }];
}

/**
 * Wraps a policy into the shape route registration's `config` field expects:
 * `config: routeAccessConfig(policy)`. Every domain module was hand-rolling
 * this same one-line closure; centralized here so the wrapping stays
 * consistent as `RouteAccessPolicy` evolves.
 */
export function routeAccessConfig(routeAccessPolicy: RouteAccessPolicy): {
  routeAccessPolicy: RouteAccessPolicy;
} {
  return { routeAccessPolicy };
}

/**
 * Wraps a policy into a route-options fragment meant to be spread directly
 * into the object passed to `r.get`/`r.post`/etc: `...routeAccessOption(policy)`.
 */
export function routeAccessOption(routeAccessPolicy: RouteAccessPolicy): {
  config: { routeAccessPolicy: RouteAccessPolicy };
} {
  return { config: { routeAccessPolicy } };
}
