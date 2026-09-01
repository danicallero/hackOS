import { afterAll, describe, expect, it } from "vitest";
import type { App } from "../src/app.js";
import { emailVerificationForRoute } from "../src/lib/route-policy.js";
import { buildTestApp } from "./helpers.js";

let app: App | undefined;

afterAll(async () => {
  await app?.close();
});

describe("final route-policy ledger", () => {
  it("has the exact classified rows, allowlists, and sole Better Auth exemption", async () => {
    app = await buildTestApp();
    const rows = app.routePolicyLedger.filter((row) => row.method !== "HEAD");
    expect(rows).toHaveLength(345);
    expect(rows.filter((row) => row.policy.kind === "public")).toHaveLength(18);
    expect(rows.filter((row) => row.policy.kind === "token")).toHaveLength(12);
    expect(rows.filter((row) => row.policy.kind === "authenticated")).toHaveLength(47);
    // +2 (H8): GET .../seed-diff and POST .../reset-to-default, both gated
    // by permissions:manage like every other role-mutation route.
    // +4 (H8): GET/POST /api/role-grant-rules and PATCH/DELETE
    // /api/role-grant-rules/:ruleId, the admin CRUD for configurable
    // automatic role grant/revoke rules — all gated by permissions:manage.
    expect(rows.filter((row) => row.policy.kind === "capability")).toHaveLength(201);
    expect(rows.filter((row) => row.policy.kind === "contextual")).toHaveLength(67);
    expect(app.routePolicyExemptions).toEqual([
      { url: "/api/auth/*", exemption: "better-auth-generated" },
    ]);
    expect(
      rows
        .filter((row) => row.policy.kind === "public")
        .map((row) => `${row.method} ${row.url}`)
        .sort(),
    ).toEqual([
      "GET /api/announcements/public",
      "GET /api/content/stream",
      "GET /api/public/activities",
      "GET /api/public/applications",
      "GET /api/public/applications/:id",
      "GET /api/public/challenges",
      "GET /api/public/event",
      "GET /api/public/food-intolerances",
      "GET /api/public/sponsors",
      "GET /api/public/universities",
      "GET /api/tv/config",
      "GET /api/tv/mode",
      "GET /api/tv/rooms",
      "GET /api/tv/stream",
      "GET /healthz",
      "GET /metrics",
      "GET /readyz",
      "POST /api/telemetry/refetch-storm",
    ]);
    expect(
      rows
        .filter((row) => row.policy.kind === "token")
        .map((row) => `${row.method} ${row.url}`)
        .sort(),
    ).toEqual([
      "DELETE /api/wallet/apple/v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier/:serialNumber",
      "GET /api/invites/lookup",
      "GET /api/wallet/apple/v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier",
      "GET /api/wallet/apple/v1/passes/:passTypeIdentifier/:serialNumber",
      "GET /api/wallet/scoped/apple/:purpose.pkpass",
      "GET /api/wallet/scoped/google/:purpose",
      "POST /api/applications/confirm",
      "POST /api/applications/decline",
      "POST /api/auth/resend-verification",
      "POST /api/invites/accept",
      "POST /api/wallet/apple/v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier/:serialNumber",
      "POST /api/wallet/apple/v1/log",
    ]);

    const verificationRequired = rows
      .filter((row) => emailVerificationForRoute(row.method, row.policy) === "caller")
      .map((row) => `${row.method} ${row.url}`);
    expect(verificationRequired).toContain("POST /api/applications/:id/response/submit");
    expect(verificationRequired).toContain("POST /api/me/responses/:responseId/confirm");
    expect(verificationRequired).toContain("POST /api/queue/rooms/:roomId/call-next");
    expect(verificationRequired).toContain("POST /api/accreditation/check-in");
    expect(verificationRequired).not.toContain("PUT /api/applications/:id/response");
    expect(verificationRequired).not.toContain("POST /api/applications/confirm");

    expect(
      rows.find((row) => row.method === "POST" && row.url === "/api/applications/confirm")?.policy,
    ).toMatchObject({ emailVerification: "target" });
    expect(
      rows.find((row) => row.method === "POST" && row.url === "/api/applications/decline")?.policy,
    ).toMatchObject({ emailVerification: "target" });
    expect(
      rows.find((row) => row.method === "POST" && row.url === "/api/me/removal-pin")?.policy,
    ).toMatchObject({ kind: "authenticated", emailVerification: "none" });
  });
});
