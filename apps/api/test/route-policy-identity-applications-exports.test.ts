import "./identity/env.js";
import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { registerRoutePolicyInfrastructure } from "../src/lib/route-policy.js";
import { registerUploadRoutes } from "../src/modules/applications/upload.routes.js";
import { registerWorkflowRoutes } from "../src/modules/exports/workflow.routes.js";
import { registerInviteRoutes } from "../src/modules/identity/routes/invites.js";

describe("identity, applications and exports route policy ledger", () => {
  const apps: ReturnType<typeof Fastify>[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("records token and contextual authorization rather than weaker policy labels", () => {
    const app = Fastify();
    apps.push(app);
    registerRoutePolicyInfrastructure(app, { enforce: true });
    registerInviteRoutes(app);
    registerUploadRoutes(app);
    registerWorkflowRoutes(app);

    const declared = app.routePolicyLedger.filter((row) => row.method !== "HEAD");
    expect(declared).toContainEqual({
      method: "POST",
      url: "/api/invites/accept",
      policy: { kind: "token", policy: "invite-accept" },
    });
    expect(declared).toContainEqual({
      method: "GET",
      url: "/api/files/download",
      policy: {
        kind: "contextual",
        policy: "application-upload-access",
        resource: { source: "query", field: "key" },
      },
    });
    expect(declared).toContainEqual({
      method: "POST",
      url: "/api/exports/requests",
      policy: {
        kind: "contextual",
        policy: "export-request-create",
        resource: { source: "body", field: "subjectUserId" },
      },
    });
  });
});
