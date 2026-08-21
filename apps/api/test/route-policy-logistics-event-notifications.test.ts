import "./logistics/env.js";
import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { registerRoutePolicyInfrastructure } from "../src/lib/route-policy.js";
import { registerEventRoutes } from "../src/modules/event/routes.js";
import { registerIntoleranceRoutes } from "../src/modules/logistics/intolerances.js";
import { registerLogisticsRoutes } from "../src/modules/logistics/routes.js";
import { registerUniversityRoutes } from "../src/modules/logistics/universities.js";
import { registerAnnouncementRoutes } from "../src/modules/notifications/routes/announcements.js";
import { registerAuditRoutes } from "../src/modules/notifications/routes/audit.js";
import { registerInboxRoutes } from "../src/modules/notifications/routes/inbox.js";
import { registerPreferenceRoutes } from "../src/modules/notifications/routes/preferences.js";
import { registerPushTokenRoutes } from "../src/modules/notifications/routes/push-tokens.js";

describe("logistics, event and notifications route policy ledger", () => {
  const apps: ReturnType<typeof Fastify>[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("requires explicit metadata for every owned route and records their access classes", () => {
    const app = Fastify();
    apps.push(app);
    registerRoutePolicyInfrastructure(app, { enforce: true });

    registerLogisticsRoutes(app);
    registerIntoleranceRoutes(app);
    registerUniversityRoutes(app);
    registerEventRoutes(app);
    registerAnnouncementRoutes(app);
    registerAuditRoutes(app);
    registerInboxRoutes(app);
    registerPreferenceRoutes(app);
    registerPushTokenRoutes(app);

    // Fastify synthesizes a matching HEAD route for each GET; the 79 explicit
    // declarations below are the reviewable API policy delta.
    const declared = app.routePolicyLedger.filter((row) => row.method !== "HEAD");
    expect(declared).toHaveLength(79);
    expect(declared).toContainEqual({
      method: "POST",
      url: "/api/schedule/publish-at",
      policy: { kind: "capability", capability: "schedule:manage" },
    });
    expect(declared).toContainEqual({
      method: "GET",
      url: "/api/schedule/owner-candidates",
      policy: { kind: "capability", capability: "schedule:manage" },
    });
    expect(declared).toContainEqual({
      method: "GET",
      url: "/api/schedule/:id/owners",
      policy: { kind: "capability", capability: "schedule:manage" },
    });
    expect(declared).toContainEqual({
      method: "POST",
      url: "/api/schedule/:id/owners",
      policy: { kind: "capability", capability: "schedule:manage" },
    });
    expect(declared).toContainEqual({
      method: "DELETE",
      url: "/api/schedule/:id/owners/:ownerId",
      policy: { kind: "capability", capability: "schedule:manage" },
    });
    expect(declared).toContainEqual({
      method: "POST",
      url: "/api/public/universities/propose",
      policy: { kind: "authenticated" },
    });
    expect(declared).toContainEqual({
      method: "GET",
      url: "/api/me/wallet/apple/:purpose.pkpass",
      policy: { kind: "authenticated" },
    });
    expect(declared).toContainEqual({
      method: "GET",
      url: "/api/wallet/apple/v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier",
      policy: { kind: "token", policy: "apple-passkit-web-service" },
    });
    expect(declared).toContainEqual({
      method: "GET",
      url: "/api/wallet/scoped/apple/:purpose.pkpass",
      policy: { kind: "token", policy: "scoped-wallet-access" },
    });
    expect(declared).toContainEqual({
      method: "GET",
      url: "/api/wallet/scoped/google/:purpose",
      policy: { kind: "token", policy: "scoped-wallet-access" },
    });
    expect(declared).toContainEqual({
      method: "GET",
      url: "/api/public/event",
      policy: { kind: "public", anonymousCategory: "public-content" },
    });
  });
});
