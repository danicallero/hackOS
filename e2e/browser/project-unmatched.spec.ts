import { CAPABILITIES } from "../../packages/shared/src/capabilities";
import { expect, shellUser, test } from "./fixtures";

test("bounds and searches unmatched people with suggested identities and explicit linking", async ({
  page,
}, testInfo) => {
  let participants = Array.from({ length: 23 }, (_, index) => ({
    repo_id: index + 1,
    repo_name: `Project ${index + 1}`,
    email: index === 0 ? "maria@devpost.test" : `person${index + 1}@devpost.test`,
    name: index === 0 ? "María" : `Person ${index + 1}`,
    surname: "López",
    devpost_username: null,
    import_batch: "October import",
    claim_email_sent_at: null,
    created_at: "2026-10-09T08:00:00Z",
  }));
  const candidates = [
    { id: 30, name: "María", surname: "Other", email: "other@platform.test" },
    { id: 31, name: "Maria", surname: "Lopez", email: "ml@platform.test" },
    { id: 32, name: "Other", surname: null, email: "maria@platform.test" },
  ];
  let links = 0;
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    let body: unknown = {};
    if (url.pathname === "/api/me")
      body = { ...shellUser, capabilities: [CAPABILITIES.PROJECTS_IMPORT], language: "en" };
    else if (url.pathname === "/api/devpost/imports/unmatched") body = { participants };
    else if (url.pathname === "/api/devpost/prizes") body = { prizes: [] };
    else if (url.pathname === "/api/public/challenges") body = { items: [] };
    else if (url.pathname === "/api/projects/member-candidates") body = { users: candidates };
    else if (url.pathname === "/api/devpost/imports/link") {
      links += 1;
      expect(route.request().postDataJSON()).toEqual({
        repoId: 1,
        email: "maria@devpost.test",
        userId: 31,
      });
      participants = participants.slice(1);
    } else if (url.pathname.includes("notifications")) body = { items: [], total: 0 };
    await route.fulfill({
      contentType: url.pathname.endsWith("/stream") ? "text/event-stream" : "application/json",
      body: url.pathname.endsWith("/stream") ? "" : JSON.stringify(body),
    });
  });
  await page.goto("/projects/unmatched");
  const cookie = page.locator('aside[aria-labelledby="cookie-notice-title"]');
  if (await cookie.isVisible()) await cookie.locator("button").first().click();
  const region = page.getByRole("region", { name: "Unmatched participants", exact: true });
  await expect(region.getByRole("listitem")).toHaveCount(10);
  await page.screenshot({ path: testInfo.outputPath("unmatched-desktop.png"), fullPage: true });
  await region.getByRole("button", { name: "Next", exact: true }).click();
  await expect(region.getByText("Person 11 López", { exact: true })).toBeVisible();
  await region.getByRole("searchbox").fill("MARIA");
  await expect(region.getByRole("listitem")).toHaveCount(1);
  await region.getByRole("combobox", { name: "Link to user", exact: true }).click();
  await expect(page.getByRole("option")).toHaveCount(2);
  await expect(page.getByRole("option").first()).toContainText("ml@platform.test");
  expect(links).toBe(0);
  await page.screenshot({ path: testInfo.outputPath("unmatched-suggestions.png"), fullPage: true });
  await page.getByRole("option").first().click();
  await expect(region.getByRole("combobox")).toContainText("ml@platform.test");
  await page.setViewportSize({ width: 320, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: testInfo.outputPath("unmatched-320.png"), fullPage: true });
  await region.getByRole("button", { name: "Link directly", exact: true }).click();
  await expect(region.getByText("No results.", { exact: true })).toBeVisible();
  expect(links).toBe(1);
});
