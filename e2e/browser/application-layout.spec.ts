import { CAPABILITIES } from "../../packages/shared/src/capabilities";
import { expect, shellUser, test } from "./fixtures";

// H12/H36: the application table shares the Users canvas, not a narrow form column.
test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const data =
      path === "/api/me"
        ? {
            ...shellUser,
            capabilities: [
              CAPABILITIES.APPLICATIONS_MANAGE,
              CAPABILITIES.APPLICATIONS_REVIEW,
              CAPABILITIES.APPLICATIONS_DECIDE,
              CAPABILITIES.EXPORTS_RUN,
            ],
          }
        : path === "/api/applications/1"
          ? {
              id: 1,
              name: "Participant form",
              template: [
                {
                  key: "cv",
                  kind: "file",
                  label: { en: "CV", es: "CV", gl: "CV" },
                  shareable_with_sponsors: true,
                },
                { key: "field_3", kind: "file", label: { en: "", es: "", gl: "" } },
              ],
              sections: [],
              grants_role_ids: [],
              description: null,
              open_at: null,
              close_at: null,
              capacity: 100,
              confirmation_window_hours: 48,
              ask_shirt_size: false,
              ask_food_intolerances: false,
              current_form_version: 1,
              has_confirmed_responses: false,
            }
          : path === "/api/applications/1/responses"
            ? {
                responses: [
                  {
                    id: 10,
                    user_id: 22,
                    name: "Sofía Martínez",
                    email: "sofia@example.test",
                    status: "confirmed",
                    responses: {},
                    staff_notes: null,
                    submitted_at: "2026-09-18T15:48:00Z",
                    decision_sent_at: "2026-09-19T15:48:00Z",
                    confirmation_expires_at: null,
                    confirmed_at: "2026-09-19T16:00:00Z",
                    declined_at: null,
                    avg_score: null,
                    review_count: 0,
                    reviews: [],
                  },
                ],
              }
            : path === "/api/exports/applications/catalog"
              ? { profile: [], metadata: [], applications: [] }
              : {};
    await route.fulfill({ json: data });
  });
});

test("sent decisions expose every column and use the shared list controls", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "chromium", "Desktop geometry regression");
  for (const width of [1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/applications/1?tab=sent");
    const table = page.getByRole("table");
    await expect(table).toBeVisible();
    const geometry = await table.evaluate((element) => ({
      width: element.getBoundingClientRect().width,
      scrollWidth: element.parentElement!.scrollWidth,
      available: element.parentElement!.clientWidth,
      lastColumnRight: element.querySelector("th:last-child")!.getBoundingClientRect().right,
      viewport: innerWidth,
      searchWidth: document.querySelector('input[type="search"]')!.getBoundingClientRect().width,
    }));
    expect(geometry.scrollWidth).toBe(geometry.available);
    expect(geometry.lastColumnRight).toBeLessThan(geometry.viewport);
    expect(geometry.width).toBeLessThanOrEqual(1280);
    expect(geometry.searchWidth).toBeGreaterThan(geometry.width * 0.65);
    await page.getByRole("searchbox").fill("Nobody");
    await expect(table.getByText("Sofía Martínez")).toHaveCount(0);
  }
});

test("mobile responses use readable rows and one export menu opens a persistent editor", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "mobile-chromium", "Mobile composition regression");
  await page.goto("/applications/1?tab=sent");
  const cookies = page.locator('aside[aria-labelledby="cookie-notice-title"]');
  if (await cookies.isVisible()) await cookies.locator("button").first().click();
  const row = page.getByRole("button", { name: "Sofía Martínez sofia@example.test", exact: true });
  await expect(row).toBeVisible();
  await expect(page.getByRole("table")).toBeHidden();
  const record = row.locator("..");
  await expect(record).toContainText("Confirmed");
  await expect(record.locator("dl")).toContainText("Communication");
  await expect(record.locator("dl")).not.toContainText("Score");
  await expect(record.locator("dl")).not.toContainText("Confirmation deadline");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: `artifacts/surfaces/application-mobile-${info.project.name}.png`,
    style: "nextjs-portal { visibility: hidden }",
  });
  const exportButton = page.getByRole("button", { name: "Export", exact: true });
  await expect(exportButton).toHaveCount(1);
  await exportButton.click();
  await expect(
    page.getByRole("menuitem", { name: "Download CV (ZIP)", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Download Attachment 2 (ZIP)", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("menu")).not.toContainText("field_3");
  await expect(
    page.getByRole("menuitem", { name: "Download CV shared with sponsors (ZIP)", exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(350);
  await page.screenshot({
    path: `artifacts/surfaces/application-export-menu-${info.project.name}.png`,
    style: "nextjs-portal { visibility: hidden }",
  });
  await page.getByRole("menuitem", { name: "Application data (CSV)", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Export application data" })).toBeVisible();
  await page.waitForTimeout(350);
  await page.screenshot({
    path: `artifacts/surfaces/application-export-${info.project.name}.png`,
    style: "nextjs-portal { visibility: hidden }",
  });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Export application data" })).toBeHidden();
  await expect(exportButton).toBeFocused();
});
