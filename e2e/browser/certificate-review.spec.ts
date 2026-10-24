import webEn from "../../packages/shared/locales/en/web.json" with { type: "json" };
import { CAPABILITIES } from "../../packages/shared/src/capabilities";
import { expect, shellUser, test } from "./fixtures";

// #1083: full evidence, a deliberate award of hours, and university-scoped CSVs.
test("reviews the full timeline and awards certified hours without changing measured time", async ({
  page,
}) => {
  let eligibility = {
    hours: 12,
    certifiedHours: null as number | null,
    eligible: false,
    reviewRequired: true,
    reason: "review_required" as string | null,
    approval: null as unknown,
  };
  let award: unknown;
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
    if (path === "/api/certificates/participants")
      body = {
        items: [
          {
            userId: 7,
            name: "Ada",
            surname: "Lovelace",
            universityId: 1,
            universityName: "Universidade da Coruña",
            eligibility,
          },
          {
            userId: 8,
            name: "Grace",
            surname: "Hopper",
            universityId: 2,
            universityName: "Universidade de Vigo",
            eligibility,
          },
        ],
      };
    if (path === "/api/users/7/certificates")
      body = {
        eligibility,
        certificates: [],
        settings: {
          minHours: 42,
          minReviewHours: 10,
          awardHours: 36.5,
          issuerName: "GPUL",
        },
      };
    if (path === "/api/users/7/certificate-evidence")
      body = {
        certaintyWindowMinutes: 720,
        activities: [],
        conflicts: [],
        windows: [],
        signals: [
          {
            id: 1,
            source: "activity",
            kind: "activity",
            occurredAt: "2026-02-28T20:00:00Z",
            activityId: 1,
            activityName: "Dinner",
            category: "dinner",
            notes: null,
            recordedBy: null,
          },
          {
            id: 2,
            source: "activity",
            kind: "activity",
            occurredAt: "2026-02-28T23:00:00Z",
            activityId: 2,
            activityName: "Midnight workshop",
            category: "workshop",
            notes: null,
            recordedBy: null,
          },
        ],
      };
    if (path === "/api/users/7/certificate-approval") {
      award = route.request().postDataJSON();
      eligibility = {
        ...eligibility,
        certifiedHours: 27.5,
        eligible: true,
        reviewRequired: false,
        reason: null,
        approval: {
          certifiedHours: 27.5,
          reason: "Reviewed dinner and midnight workshop",
          approvedBy: 1,
          approvedAt: new Date().toISOString(),
        },
      };
      body = eligibility;
    }
    if (path === "/api/certificates/participants/export.csv")
      return route.fulfill({
        contentType: "text/csv",
        headers: { "content-disposition": 'attachment; filename="udc.csv"' },
        body: "certified_hours\r\n27.5\r\n",
      });
    if (path === "/api/exports/activities/catalog") body = { activities: [] };
    await route.fulfill({ json: body });
  });
  await page.goto("/logistics/presence?tab=certificates");
  const cookies = page.locator('aside[aria-labelledby="cookie-notice-title"]');
  await expect(cookies).toBeVisible();
  await cookies.locator("button").first().click();
  await page.getByRole("combobox", { name: webEn.certificateUniversity }).click();
  await page.getByRole("option", { name: "Universidade da Coruña" }).click();
  await expect(page.getByRole("button", { name: "Grace Hopper" })).toHaveCount(0);
  await page.getByRole("button", { name: "Ada Lovelace", exact: true }).click();
  await expect(page.getByText("Dinner", { exact: true })).toBeVisible();
  await expect(page.getByText("Midnight workshop", { exact: true })).toBeVisible();
  await page.screenshot({
    path: `artifacts/settings/certificate-review-${test.info().project.name}.png`,
    fullPage: true,
    animations: "disabled",
  });
  await expect(
    page.getByRole("button", { name: webEn.certificatePersonEvidenceCsv }),
  ).toBeVisible();
  await expect(page.getByRole("spinbutton", { name: webEn.certificateCertifiedHours })).toHaveValue(
    "36.5",
  );
  await page.getByRole("spinbutton", { name: webEn.certificateCertifiedHours }).fill("27.5");
  await page
    .getByRole("textbox", { name: webEn.certificateOverrideReason })
    .fill("Reviewed dinner and midnight workshop");
  await page.getByRole("button", { name: webEn.certificateApproveHours }).click();
  await expect
    .poll(() => award)
    .toEqual({ certifiedHours: 27.5, reason: "Reviewed dinner and midnight workshop" });
  await expect(page.getByText(/Certified hours: 27\.5/)).toBeVisible();
  await expect(page.locator("[data-sileo-toast]")).toHaveCount(0);
  await page.getByRole("button", { name: webEn.certificateApproveHours }).scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `artifacts/settings/certificate-award-${test.info().project.name}.png`,
    fullPage: true,
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  const request = page.waitForRequest((r) =>
    r.url().includes("/api/certificates/participants/export.csv"),
  );
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: webEn.certificateUdcCsv }).click();
  expect(new URL((await request).url()).searchParams.get("universityId")).toBe("1");
  await download;
});
