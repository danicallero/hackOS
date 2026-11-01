import { CAPABILITIES } from "../../packages/shared/src/capabilities";
import { expect, shellUser, test } from "./fixtures";

// H59: fixed columns must retain finite widths in every browser engine.
test("schedule columns remain readable and resize inside the horizontal scroller", async ({
  page,
}) => {
  await page.route("**/api/**", async (route) => {
    if (new URL(route.request().url()).pathname === "/api/me/public-profile") {
      return route.fallback();
    }
    const path = new URL(route.request().url()).pathname;
    let body: unknown = { items: [] };
    if (path === "/api/me") body = { ...shellUser, capabilities: [CAPABILITIES.SCHEDULE_MANAGE] };
    if (path === "/api/me/ui-prefs") body = {};
    if (path === "/api/schedule")
      body = {
        items: [
          {
            id: 1,
            title: "Browser layout workshop",
            description: null,
            location: "Main hall",
            type: "workshop",
            startsAt: "2026-10-13T10:00:00Z",
            endsAt: "2026-10-13T11:00:00Z",
            visibility: "shown",
            publishAt: null,
            audiences: ["participant"],
            primaryLanguage: "en",
            titleI18n: {},
            descriptionI18n: {},
          },
        ],
      };
    await route.fulfill({ json: body });
  });
  await page.goto("/schedule");
  const cookies = page.locator('aside[aria-labelledby="cookie-notice-title"]');
  await expect(cookies).toBeVisible();
  await cookies.locator("button").first().click();
  const table = page.getByRole("table");
  const row = table.getByRole("row").filter({ hasText: "Browser layout workshop" });
  await expect(row).toBeVisible();
  const firstCell = row.getByRole("cell").first();
  await expect.poll(async () => (await firstCell.boundingBox())?.width ?? 0).toBeLessThan(200);
  const firstHeader = table.getByRole("columnheader").nth(1);
  const before = await firstHeader.boundingBox();
  expect(before?.width).toBeGreaterThan(50);
  expect(before?.width).toBeLessThan(200);
  await firstHeader.getByRole("button", { name: "Resize column" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(async () => (await firstHeader.boundingBox())?.width ?? 0)
    .toBeCloseTo((before?.width ?? 0) + 16, 0);
  await expect.poll(async () => (await table.boundingBox())?.width ?? 0).toBeLessThan(5000);
  await row
    .getByRole("cell")
    .filter({ hasText: "Browser layout workshop" })
    .scrollIntoViewIfNeeded();
  await expect(
    row.getByRole("cell").filter({ hasText: "Browser layout workshop" }),
  ).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const locationButton = row.getByRole("button", { name: "Edit Location: Main hall", exact: true });
  await locationButton.click();
  const locationInput = row.getByRole("textbox");
  await expect(locationInput).toBeFocused();
  await locationInput.fill("Unsaved location");
  await locationInput.press("Escape");
  await expect(locationButton).toBeVisible();
  const timeButton = row.getByRole("button", { name: /^Edit Starts:/ }).first();
  const originalTime = await timeButton.getAttribute("aria-label");
  await timeButton.click();
  const timeInput = row.getByPlaceholder("HH:MM");
  await expect(timeInput).toBeFocused();
  await timeInput.fill("23:59");
  await timeInput.press("Escape");
  await expect(
    row.getByRole("button", { name: originalTime ?? "", exact: true }).first(),
  ).toBeVisible();
  await page.screenshot({
    path: `artifacts/schedule-${test.info().project.name}.png`,
    fullPage: true,
  });
});
