import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import {
  openApiSecurityForPolicy,
  type RouteAccessPolicy,
  registerRoutePolicyInfrastructure,
} from "../src/lib/route-policy.js";

describe("RouteAccessPolicy infrastructure", () => {
  const apps: ReturnType<typeof Fastify>[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("fails registration of an application route without mandatory metadata", () => {
    const app = Fastify();
    apps.push(app);
    registerRoutePolicyInfrastructure(app, { enforce: true });

    expect(() => app.get("/api/private", async () => ({ ok: true }))).toThrow(
      "missing mandatory RouteAccessPolicy metadata",
    );
  });

  it("records declared policies and permits only the narrow Better Auth exemption", () => {
    const app = Fastify();
    apps.push(app);
    registerRoutePolicyInfrastructure(app, { enforce: true });
    app.get(
      "/api/public/example",
      { config: { routeAccessPolicy: { kind: "public", anonymousCategory: "public-content" } } },
      async () => ({ ok: true }),
    );
    app.route({
      method: "GET",
      url: "/api/auth/*",
      config: { routeAccessPolicyExemption: "better-auth-generated" },
      handler: async () => ({ ok: true }),
    });

    expect(app.routePolicyLedger).toContainEqual({
      method: "GET",
      url: "/api/public/example",
      policy: { kind: "public", anonymousCategory: "public-content" },
    });
    expect(app.routePolicyExemptions).toEqual([
      { url: "/api/auth/*", exemption: "better-auth-generated" },
    ]);
    expect(() =>
      app.get(
        "/api/not-auth",
        { config: { routeAccessPolicyExemption: "better-auth-generated" } },
        async () => ({ ok: true }),
      ),
    ).toThrow("limited to /api/auth/*");
  });

  it("permits contextual collection policies without inventing a resource locator", () => {
    const app = Fastify();
    apps.push(app);
    registerRoutePolicyInfrastructure(app, { enforce: true });
    const policy: RouteAccessPolicy = { kind: "contextual", policy: "challenge:list" };

    app.get("/api/challenges", { config: { routeAccessPolicy: policy } }, async () => ({
      ok: true,
    }));

    expect(app.routePolicyLedger).toContainEqual({
      method: "GET",
      url: "/api/challenges",
      policy,
    });
  });

  it("retains and validates resource locators for resource-bound contextual policies", () => {
    const app = Fastify();
    apps.push(app);
    registerRoutePolicyInfrastructure(app, { enforce: true });
    const policy: RouteAccessPolicy = {
      kind: "contextual",
      policy: "project:read",
      resource: { source: "params", field: "projectId" },
    };

    app.get("/api/projects/:projectId", { config: { routeAccessPolicy: policy } }, async () => ({
      ok: true,
    }));

    expect(app.routePolicyLedger).toContainEqual({
      method: "GET",
      url: "/api/projects/:projectId",
      policy,
    });
  });

  it("rejects malformed contextual policy metadata when registering a route", () => {
    const app = Fastify();
    apps.push(app);
    registerRoutePolicyInfrastructure(app, { enforce: true });

    expect(() =>
      app.get(
        "/api/projects/:projectId",
        {
          config: {
            routeAccessPolicy: {
              kind: "contextual",
              policy: "project:read",
              resource: { source: "path", field: "projectId" },
            } as unknown as RouteAccessPolicy,
          },
        },
        async () => ({ ok: true }),
      ),
    ).toThrow("invalid contextual resource source");
    expect(() =>
      app.get(
        "/api/reviews/:reviewId",
        {
          config: {
            routeAccessPolicy: {
              kind: "contextual",
              policy: "review:read",
              resource: { source: "params", field: "reviewId.." },
            } as unknown as RouteAccessPolicy,
          },
        },
        async () => ({ ok: true }),
      ),
    ).toThrow("invalid contextual resource field");
    expect(() =>
      app.get(
        "/api/rooms",
        {
          config: {
            routeAccessPolicy: {
              kind: "contextual",
              policy: "",
            } as unknown as RouteAccessPolicy,
          },
        },
        async () => ({ ok: true }),
      ),
    ).toThrow("empty contextual policy");
  });

  it("rejects malformed public, token, and capability metadata at registration", () => {
    const app = Fastify();
    apps.push(app);
    registerRoutePolicyInfrastructure(app, { enforce: true });
    const route = (url: string, policy: unknown) =>
      app.get(url, { config: { routeAccessPolicy: policy as RouteAccessPolicy } }, async () => ({
        ok: true,
      }));

    expect(() =>
      route("/api/public/bad", { kind: "public", anonymousCategory: "anything" }),
    ).toThrow("invalid public category");
    expect(() => route("/api/token/bad", { kind: "token", policy: " " })).toThrow(
      "empty token policy",
    );
    expect(() =>
      route("/api/capability/bad", { kind: "capability", capability: "not:real" }),
    ).toThrow("unknown capability");
    expect(() => route("/api/kind/bad", { kind: "role" })).toThrow("unknown policy kind");
    expect(() => route("/api/array/bad", { kind: "capability", anyOf: "users:read" })).toThrow(
      "malformed capability policy",
    );
    expect(() => route("/api/array/value-bad", { kind: "capability", allOf: [1] })).toThrow(
      "malformed capability policy",
    );
  });

  it("derives OpenAPI security from policy instead of a path allowlist", () => {
    expect(openApiSecurityForPolicy({ kind: "public", anonymousCategory: "public-tv" })).toEqual(
      [],
    );
    expect(openApiSecurityForPolicy({ kind: "token", policy: "passkit" })).toEqual([]);
    expect(openApiSecurityForPolicy({ kind: "capability", capability: "queue:admin" })).toEqual([
      { sessionToken: [] },
      { bearerToken: [] },
    ]);
    expect(openApiSecurityForPolicy({ kind: "authenticated" })).toEqual([
      { sessionToken: [] },
      { bearerToken: [] },
    ]);
  });
});
