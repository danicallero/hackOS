import commonEn from "../../packages/shared/locales/en/common.json" with { type: "json" };
import webEn from "../../packages/shared/locales/en/web.json" with { type: "json" };
import { CAPABILITIES } from "../../packages/shared/src/capabilities";
import { expect, shellUser, test } from "./fixtures";

// #1083: guests stay manageable in Event settings after the issuance dialog closes.
test("issues a guest talk certificate and searches, downloads and revokes it in settings", async ({
  page,
}) => {
  const tr = (text: string) => ({ en: text, es: text, gl: text });
  const type = {
    id: 4,
    revision: 1,
    legacyVariant: null,
    name: tr("Speaker"),
    title: tr("Speaker certificate"),
    body: tr("{recipient} gave {activity} at {event}."),
    enabled: true,
    attendancePolicy: false,
    selfService: false,
    audienceRoleIds: [],
    allowGuests: true,
    identityPolicy: "optional",
    requiresActivity: true,
    requiresEventEnd: false,
    demoRequirement: "none",
    demoChallengeId: null,
    exemptRoleIds: null,
  };
  const records: Record<string, unknown>[] = [];
  let issueBody: Record<string, unknown> | undefined;
  let downloads = 0;
  let revokeBody: unknown;
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/me/public-profile") return route.fallback();
    let body: unknown = { items: [], total: 0 };
    if (path === "/api/me") body = { ...shellUser, capabilities: [CAPABILITIES.PRESENCE_MANAGE] };
    if (path === "/api/event") body = { name: "HackUDC", timezone: "Europe/Madrid" };
    if (path === "/api/certificates/settings")
      body = {
        minHours: null,
        minReviewHours: null,
        awardHours: null,
        issuerName: "GPUL",
      };
    if (path === "/api/certificates/types") body = { items: [type], roles: [], challenges: [] };
    if (path === "/api/certificates/issued") body = { items: records };
    if (path === "/api/certificates/issue") {
      issueBody = route.request().postDataJSON();
      records.push({
        id: 101,
        typeId: 4,
        typeName: "Speaker",
        userId: null,
        recipientName: issueBody?.guestName,
        activityName: issueBody?.activityName,
        variant: "participation",
        locale: "en",
        code: "abcdefghijklmnopqrstuvwx",
        issuedAt: "2026-10-24T12:00:00Z",
        revokedAt: null,
      });
      body = records[0];
    }
    if (path === "/api/certificates/101/pdf") {
      downloads++;
      return route.fulfill({
        status: 200,
        contentType: "application/pdf",
        body: "%PDF-1.7 fixture",
      });
    }
    if (path === "/api/certificates/101/revoke") {
      revokeBody = route.request().postDataJSON();
      records[0].revokedAt = "2026-10-24T13:00:00Z";
      body = records[0];
    }
    await route.fulfill({ json: body });
  });
  await page.goto("/settings/event?tab=certificates");
  const cookies = page.locator('aside[aria-labelledby="cookie-notice-title"]');
  await expect(cookies).toBeVisible();
  await cookies.locator("button").first().click();
  await page.getByRole("button", { name: webEn.certificateIssueConfigured, exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox", { name: webEn.certificateType, exact: true }).click();
  await page.getByRole("option", { name: "Speaker", exact: true }).click();
  await dialog.getByRole("checkbox", { name: webEn.certificateGuestRecipient }).click();
  await dialog.getByRole("textbox", { name: webEn.certificateRecipientName }).fill("Grace Hopper");
  await dialog
    .getByRole("textbox", { name: webEn.certificateTalkActivity })
    .fill("Compilers after midnight");
  await page.screenshot({
    path: `artifacts/settings/certificate-guest-issue-${test.info().project.name}.png`,
    fullPage: true,
    animations: "disabled",
  });
  await dialog.getByRole("button", { name: webEn.certificateIssueAction, exact: true }).click();
  await expect(dialog.getByText(webEn.certificateIssuedToast, { exact: true })).toBeVisible();
  expect(issueBody).toMatchObject({
    typeId: 4,
    guestName: "Grace Hopper",
    activityName: "Compilers after midnight",
    includeIdentification: false,
  });
  expect(issueBody).not.toHaveProperty("documentNumber");
  await page.keyboard.press("Escape");
  await expect(page.getByText("Grace Hopper", { exact: true })).toBeVisible();
  const search = page.getByRole("searchbox");
  await search.fill("not this guest");
  await expect(page.getByText("Grace Hopper", { exact: true })).toHaveCount(0);
  await search.fill("Compilers");
  await expect(page.getByText("Grace Hopper", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: webEn.certificateDownload, exact: true }).click();
  await expect.poll(() => downloads).toBe(1);
  await page.screenshot({
    path: `artifacts/settings/certificate-guest-register-${test.info().project.name}.png`,
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Grace Hopper", exact: true }).click();
  await page.getByRole("menuitem", { name: webEn.certificateRevoke, exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("textbox", { name: webEn.reasonLabel })
    .fill("Wrong talk");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: webEn.certificateRevoke, exact: true })
    .click();
  await expect.poll(() => revokeBody).toEqual({ reason: "Wrong talk" });
  await expect(page.getByText(webEn.certificateRevoked, { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: webEn.certificateDownload, exact: true }),
  ).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: `artifacts/settings/certificate-guest-revoked-${test.info().project.name}.png`,
    fullPage: true,
    animations: "disabled",
  });
});

// #1083: type content and recipient rules are editable without fixed recipient groups or hours.
test("edits trilingual wording and recipient rules for a certificate type", async ({ page }) => {
  const tr = (text: string) => ({ en: text, es: text, gl: text });
  const type = {
    id: 4,
    revision: 1,
    legacyVariant: null,
    name: tr("Speaker"),
    title: tr("Speaker certificate"),
    body: tr("{recipient} gave {activity} at {event}."),
    enabled: true,
    attendancePolicy: false,
    selfService: false,
    audienceRoleIds: null,
    allowGuests: false,
    identityPolicy: "optional",
    requiresActivity: false,
    requiresEventEnd: false,
    demoRequirement: "none",
    demoChallengeId: null,
    exemptRoleIds: null,
  };
  let saved: Record<string, unknown> | undefined;
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/me/public-profile") return route.fallback();
    let body: unknown = { items: [], total: 0 };
    if (path === "/api/me") body = { ...shellUser, capabilities: [CAPABILITIES.PRESENCE_MANAGE] };
    if (path === "/api/event") body = { name: "HackUDC", timezone: "Europe/Madrid" };
    if (path === "/api/certificates/settings")
      body = {
        minHours: null,
        minReviewHours: null,
        awardHours: null,
        issuerName: "GPUL",
      };
    if (path === "/api/certificates/types")
      body = { items: [type], roles: [{ id: 7, name: "Mentor" }], challenges: [] };
    if (path === "/api/certificates/types/4") {
      saved = route.request().postDataJSON();
      body = { ...type, ...(saved?.definition as object), revision: 2 };
    }
    await route.fulfill({ json: body });
  });
  await page.goto("/settings/event?tab=certificates");
  const cookies = page.locator('aside[aria-labelledby="cookie-notice-title"]');
  await expect(cookies).toBeVisible();
  await cookies.locator("button").first().click();
  await page.getByRole("tab", { name: webEn.certificateTypes, exact: true }).click();
  await page.getByRole("button", { name: commonEn.edit, exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("textbox", { name: webEn.certificateDocumentTitle })
    .fill("Certificate of speaking");
  await dialog
    .getByRole("textbox", { name: webEn.certificateDocumentText })
    .fill("{recipient} presented {activity}.");
  await dialog.getByRole("checkbox", { name: webEn.certificateAllowGuests }).click();
  await dialog.getByRole("checkbox", { name: webEn.certificateRequiresTalk }).click();
  await expect(dialog.getByRole("checkbox", { name: webEn.certificateSelfService })).toBeDisabled();
  await dialog
    .getByRole("combobox", { name: webEn.certificateIdentificationPolicy, exact: true })
    .click();
  await page.getByRole("option", { name: webEn.certificateIdRequired, exact: true }).click();
  await page.screenshot({
    path: `artifacts/settings/certificate-type-editor-${test.info().project.name}.png`,
    fullPage: true,
    animations: "disabled",
  });
  await dialog.getByRole("button", { name: webEn.saveChanges, exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(saved).toMatchObject({
    revision: 1,
    definition: {
      title: {
        en: "Certificate of speaking",
        es: "Speaker certificate",
        gl: "Speaker certificate",
      },
      body: { en: "{recipient} presented {activity}." },
      allowGuests: true,
      requiresActivity: true,
      identityPolicy: "required",
      selfService: false,
    },
  });
});

// #1083: accepted spot follows event access, not attendance eligibility.
test("downloads the predefined accepted spot certificate without any attendance hours", async ({
  page,
}) => {
  const tr = (text: string) => ({ en: text, es: text, gl: text });
  const types = [
    {
      id: 1,
      legacyVariant: "participation",
      name: tr("Attendance"),
      attendancePolicy: true,
      selfService: true,
      requiresActivity: false,
    },
    {
      id: 2,
      legacyVariant: "hours",
      name: tr("Hours"),
      attendancePolicy: true,
      selfService: true,
      requiresActivity: false,
    },
    {
      id: 4,
      legacyVariant: "accepted_spot",
      name: tr("Accepted spot"),
      attendancePolicy: false,
      selfService: true,
      requiresActivity: false,
    },
  ];
  const records: Record<string, unknown>[] = [];
  let request: unknown;
  let downloaded = 0;
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/me/public-profile") return route.fallback();
    let body: unknown = { items: [], total: 0 };
    if (path === "/api/me") body = { ...shellUser, capabilities: [], hasEventAccess: true };
    if (path === "/api/me/certificates")
      body = {
        settings: {
          minHours: null,
          minReviewHours: null,
          awardHours: null,
          issuerName: "GPUL",
        },
        eligibility: {
          hours: 0,
          certifiedHours: null,
          eligible: false,
          reviewRequired: false,
          reason: "not_available",
          approval: null,
        },
        types,
        certificates: records,
      };
    if (path === "/api/public/food-intolerances") body = { intolerances: [] };
    if (path === "/api/me/removal-eligibility") body = { action: "delete" };
    if (path === "/api/me/certificates/104/pdf") {
      downloaded++;
      return route.fulfill({
        status: 200,
        contentType: "application/pdf",
        body: "%PDF-1.7 fixture",
      });
    }
    if (path === "/api/me/certificates/issue") {
      request = route.request().postDataJSON();
      records.push({
        id: 104,
        typeId: 4,
        typeName: "Accepted spot",
        userId: shellUser.id,
        recipientName: shellUser.name,
        activityName: "",
        variant: "participation",
        locale: "en",
        code: "abcdefghijklmnopqrstuvwx",
        issuedAt: "2026-10-24T12:00:00Z",
        revokedAt: null,
        supersededAt: null,
        outdated: false,
      });
      body = records[0];
    }
    await route.fulfill({ json: body });
  });
  await page.goto("/settings/profile?tab=wallet");
  const cookies = page.locator('aside[aria-labelledby="cookie-notice-title"]');
  await expect(cookies).toBeVisible();
  await cookies.locator("button").first().click();
  const row = page.getByRole("listitem").filter({ hasText: "Accepted spot" });
  const download = row.getByRole("button", { name: webEn.certificateDownload, exact: true });
  await expect(download).toBeEnabled();
  await download.click();
  await expect.poll(() => request).toEqual({ typeId: 4, locale: "en", refresh: false });
  await expect.poll(() => downloaded).toBe(1);
  await expect(
    row.getByRole("button", { name: webEn.certificateDownload, exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: `artifacts/settings/certificate-accepted-spot-${test.info().project.name}.png`,
    fullPage: true,
    animations: "disabled",
  });
});
