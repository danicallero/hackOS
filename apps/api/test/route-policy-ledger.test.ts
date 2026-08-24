import { afterAll, describe, expect, it } from "vitest";
import type { App } from "../src/app.js";
import { buildTestApp } from "./helpers.js";

let app: App | undefined;

afterAll(async () => {
  await app?.close();
});

describe("final route-policy ledger", () => {
  it("has the exact classified rows, allowlists, and sole Better Auth exemption", async () => {
    app = await buildTestApp();
    const rows = app.routePolicyLedger.filter((row) => row.method !== "HEAD");
    expect(rows).toHaveLength(310);
    expect(rows.filter((row) => row.policy.kind === "public")).toHaveLength(15);
    expect(rows.filter((row) => row.policy.kind === "token")).toHaveLength(12);
    expect(rows.filter((row) => row.policy.kind === "authenticated")).toHaveLength(42);
    expect(rows.filter((row) => row.policy.kind === "capability")).toHaveLength(188);
    expect(rows.filter((row) => row.policy.kind === "contextual")).toHaveLength(53);
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
  });
});
