import webEn from "../../packages/shared/locales/en/web.json" with { type: "json" };
import { CAPABILITIES } from "../../packages/shared/src/capabilities";
import { expect, shellUser, test } from "./fixtures";

// H8/H10: responsive roster actions and selected fields in mobile entries.
test("users actions fit and mobile tags follow the column selection", async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = { items: [], total: 0 };
    if (path === "/api/me") body = { ...shellUser, capabilities: [CAPABILITIES.ADMIN_ALL] };
    if (path === "/api/users")
      body = {
        users: [
          {
            id: 22,
            name: "Alex",
            surname: "Roster",
            email: "alex.with.a.long.address@example.com",
            emailVerified: true,
            visibleRoleName: "Long organizer role",
            applicationStatus: "confirmed",
            badgeId: "BADGE-22",
            language: "en",
            shirtSize: "M",
            foodIntolerances: [],
            foodIntoleranceNotes: null,
            confirmedSpot: true,
            isTestAccount: false,
            createdAt: "2026-10-01T12:00:00Z",
          },
        ],
        total: 1,
      };
    if (path === "/api/admin/review-fixtures") body = { generation: 0, accounts: [] };
    await route.fulfill({ json: body });
  });
  await page.goto("/users");
  const cookies = page.locator('aside[aria-labelledby="cookie-notice-title"]');
  await expect(cookies).toBeVisible();
  await cookies.locator("button").first().click();
  const header = page
    .locator("header")
    .filter({ has: page.getByRole("heading", { name: "Users", exact: true }) });
  const actions = header.locator('[data-slot="action-group"]');
  const more = actions.getByRole("button", { name: "More actions", exact: true });
  await expect(actions.getByRole("button")).toHaveCount(1);
  await more.click();
  await expect(page.getByRole("menuitem", { name: "Invitations", exact: true })).toBeVisible();
  await page.getByRole("menuitem", { name: "Export", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await more.click();
  await page.getByRole("menuitem", { name: webEn.reviewFixturesButton }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const fieldsButton = page.getByRole("button", {
    name: test.info().project.name === "mobile-chromium" ? "Tags" : "Columns",
    exact: true,
  });
  const search = page.getByRole("searchbox");
  await search.focus();
  await expect(search).toHaveCSS("border-color", "rgb(3, 8, 70)");
  await page.screenshot({ path: `artifacts/settings/focus-light-${test.info().project.name}.png` });
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await expect(search).toHaveCSS("border-color", "rgb(163, 213, 255)");
  await page.screenshot({ path: `artifacts/settings/focus-dark-${test.info().project.name}.png` });
  await page.evaluate(() => document.documentElement.classList.remove("dark"));
  const filter = page.getByRole("button", { name: "Filters", exact: true });
  const inputBounds = await search.boundingBox();
  const filterBounds = await filter.boundingBox();
  const fieldBounds = await fieldsButton.boundingBox();
  if (inputBounds && filterBounds && fieldBounds) {
    expect(Math.abs(inputBounds.y - filterBounds.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(inputBounds.y - fieldBounds.y)).toBeLessThanOrEqual(1);
  }
  await fieldsButton.click();
  await page.getByRole("menuitemcheckbox", { name: webEn.colShirt, exact: true }).click();
  await page.keyboard.press("Escape");
  if (test.info().project.name === "mobile-chromium") {
    const row = page.getByRole("link").filter({ hasText: "Alex Roster" });
    await expect(row).toContainText(webEn.colShirt);
    await expect(row).toContainText("M");
    await expect(row).toContainText(webEn.colJoined);
    await fieldsButton.click();
    await page.getByRole("menuitemcheckbox", { name: webEn.colRole, exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(row).not.toContainText("Long organizer role");
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: `artifacts/settings/users-${test.info().project.name}.png`,
    fullPage: true,
  });
});
