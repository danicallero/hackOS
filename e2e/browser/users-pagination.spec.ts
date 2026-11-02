import { CAPABILITIES } from "../../packages/shared/src/capabilities";
import { expect, shellUser, test } from "./fixtures";

test("the roster paginates beyond 200 with 50 users per page", async ({ page }) => {
  const users = Array.from({ length: 205 }, (_, index) => ({
    id: index + 1,
    name: `Person ${String(index + 1).padStart(3, "0")}`,
    surname: "Roster",
    email: `person${index + 1}@example.com`,
    emailVerified: true,
    visibleRoleName: "Organizer",
    applicationStatus: null,
    badgeId: null,
    language: "en",
    shirtSize: "M",
    foodIntolerances: [],
    foodIntoleranceNotes: null,
    confirmedSpot: false,
    isTestAccount: false,
    image: null,
    createdAt: "2026-10-01T12:00:00Z",
  }));
  const offsets: number[] = [];
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/me/public-profile") return route.fallback();
    let body: unknown = { items: [], total: 0 };
    if (url.pathname === "/api/me") body = { ...shellUser, capabilities: [CAPABILITIES.ADMIN_ALL] };
    if (url.pathname === "/api/users") {
      const offset = Number(url.searchParams.get("offset"));
      offsets.push(offset);
      body = {
        users: users.slice(offset, offset + Number(url.searchParams.get("limit"))),
        total: users.length,
      };
    }
    await route.fulfill({ json: body });
  });
  await page.goto("/users");
  const cookies = page.locator('aside[aria-labelledby="cookie-notice-title"]');
  await expect(cookies).toBeVisible();
  await cookies.locator("button").first().click();
  const pagination = page.getByRole("navigation", { name: "Table pagination" });
  await expect(pagination).toContainText("205");
  await expect(page.getByRole("link", { name: /^Person 050 Roster/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /^Person 051 Roster/ })).toHaveCount(0);
  for (let i = 0; i < 4; i++)
    await pagination.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("link", { name: /^Person 205 Roster/ })).toBeVisible();
  await expect(pagination.getByRole("button", { name: "Next", exact: true })).toBeDisabled();
  expect(offsets).toEqual([0, 200]);
  await page.screenshot({
    path: `artifacts/settings/users-pagination-${test.info().project.name}.png`,
    fullPage: true,
  });
});

test("role members outside the first batch resolve their names and emails", async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/me/public-profile") return route.fallback();
    let body: unknown = [];
    if (url.pathname === "/api/me") body = { ...shellUser, capabilities: [CAPABILITIES.ADMIN_ALL] };
    if (url.pathname === "/api/roles")
      body = [
        {
          id: 1,
          name: "Organizer",
          position: 1,
          isVisible: true,
          eventAccess: true,
          isProtected: false,
          isSeeded: false,
          capabilities: [],
          memberIds: [1],
          deletedAt: null,
        },
      ];
    if (url.pathname === "/api/users") {
      const offset = Number(url.searchParams.get("offset"));
      body = {
        users:
          offset === 0
            ? Array.from({ length: 200 }, (_, index) => ({
                id: index + 2,
                name: "Recent",
                surname: "User",
                email: `recent${index}@example.com`,
              }))
            : [{ id: 1, name: "Older", surname: "Member", email: "older@example.com" }],
        total: 201,
      };
    }
    await route.fulfill({ json: body });
  });
  await page.goto("/permissions?role=1&tab=members");
  const cookies = page.locator('aside[aria-labelledby="cookie-notice-title"]');
  await expect(cookies).toBeVisible();
  await cookies.locator("button").first().click();
  if (test.info().project.name !== "mobile-chromium")
    await expect(
      page.getByRole("button", { name: "Organizer", exact: false }).first(),
    ).toBeVisible();
  await expect(page.getByRole("link", { name: "Older Member", exact: true })).toBeVisible();
  await expect(page.getByText("older@example.com", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "User #1", exact: true })).toHaveCount(0);
  await expect(page.getByText("Could not load users.", { exact: true })).toHaveCount(0);
  await page.screenshot({
    path: `artifacts/settings/permissions-member-${test.info().project.name}.png`,
    fullPage: true,
  });
});
