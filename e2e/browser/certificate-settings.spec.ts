import webEn from "../../packages/shared/locales/en/web.json" with { type: "json" };
import { CAPABILITIES } from "../../packages/shared/src/capabilities";
import { expect, shellUser, test } from "./fixtures";

// #1083: organisers can enable, configure and disable self-service certificates.
test("saves the certificate policy and disables automatic issuance", async ({ page }) => {
  let policy = {
    minHours: null as number | null,
    minReviewHours: null as number | null,
    awardHours: null as number | null,
    requiresDemo: false,
    issuerName: "GPUL",
  };
  const writes: unknown[] = [];
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/me/public-profile") return route.fallback();
    let body: unknown = { items: [], total: 0 };
    if (path === "/api/me")
      body = {
        ...shellUser,
        capabilities: [
          CAPABILITIES.PRESENCE_MANAGE,
          CAPABILITIES.LOGISTICS_STATS,
          CAPABILITIES.EXPORTS_RUN,
        ],
      };
    if (path === "/api/event")
      body = {
        name: "HackUDC",
        timezone: "Europe/Madrid",
        presenceAutoEntryAt: null,
        presenceCertaintyWindowMinutes: 720,
      };
    if (path === "/api/certificates/settings") {
      if (route.request().method() === "PUT") {
        const patch = route.request().postDataJSON();
        writes.push(patch);
        policy = { ...policy, ...patch };
      }
      body = policy;
    }
    if (path === "/api/exports/activities/catalog") body = { activities: [] };
    await route.fulfill({ json: body });
  });
  await page.goto("/settings/event");
  const cookies = page.locator('aside[aria-labelledby="cookie-notice-title"]');
  await expect(cookies).toBeVisible();
  await cookies.locator("button").first().click();
  await page.getByRole("link", { name: webEn.certificates, exact: true }).click();
  const automatic = page.getByRole("switch", { name: webEn.certificateAutomaticIssue });
  const hours = page.getByRole("spinbutton", { name: webEn.certificateMinConfirmedHours });
  await expect(automatic).not.toBeChecked();
  await expect(hours).toHaveCount(0);
  await automatic.click();
  await expect(hours).toHaveValue("");
  const awardHours = page.getByRole("spinbutton", { name: webEn.certificatePolicyAwardHours });
  await expect(awardHours).toHaveValue("");
  await hours.fill("42");
  await awardHours.fill("36.5");
  await page.getByRole("spinbutton", { name: webEn.certificateMinReviewHours }).fill("10");
  await page.getByRole("switch", { name: webEn.certificateRequiresDemo }).click();
  await page.getByRole("textbox", { name: webEn.certificateIssuerName }).fill("GPUL association");
  await page.getByRole("button", { name: webEn.saveChanges, exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toEqual({
    minHours: 42,
    awardHours: 36.5,
    minReviewHours: 10,
    requiresDemo: true,
    issuerName: "GPUL association",
  });
  await expect(page.getByRole("button", { name: webEn.saveChanges, exact: true })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: `artifacts/settings/certificates-enabled-${test.info().project.name}.png`,
    fullPage: true,
    animations: "disabled",
  });
  await automatic.click();
  await page.getByRole("button", { name: webEn.saveChanges, exact: true }).click();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[1]).toEqual({ minHours: null });
  await expect(hours).toHaveCount(0);
  await page.screenshot({
    path: `artifacts/settings/certificates-disabled-${test.info().project.name}.png`,
    fullPage: true,
    animations: "disabled",
  });
  await page.goto("/settings/event?tab=presence");
  await expect(
    page.getByRole("button", { name: webEn.presenceExportTitle, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: webEn.activityAttendanceExport, exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: webEn.certificateReviewAttendance })).toHaveAttribute(
    "href",
    "/logistics/presence?tab=certificates",
  );
  await page.screenshot({
    path: `artifacts/settings/presence-policy-${test.info().project.name}.png`,
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: webEn.presenceExportTitle, exact: true }).click();
  await expect(page.getByText(webEn.presenceHoursDetailed, { exact: true })).toBeVisible();
  await page.screenshot({
    path: `artifacts/settings/presence-exports-${test.info().project.name}.png`,
    fullPage: true,
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: webEn.activityAttendanceExport, exact: true }).click();
  await expect(page.getByRole("heading", { name: webEn.activityAttendanceExport })).toBeVisible();
});
