import { mkdir } from "node:fs/promises";
import { CAPABILITIES } from "../../packages/shared/src/capabilities";
import { expect, shellUser, test } from "./fixtures";

test("organizer schedules private challenge winners", async ({ page }, info) => {
  let publishAt: string | null = null;
  await page.addInitScript(() => {
    localStorage.setItem("hackos-language", "en");
    localStorage.setItem("hackos.cookie-notice.dismissed", "true");
  });
  await page.route("**/api/**", (route) => {
    if (new URL(route.request().url()).pathname === "/api/me/public-profile") {
      return route.fallback();
    }
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/me")
      return route.fulfill({ json: { ...shellUser, capabilities: [CAPABILITIES.QUEUE_ADMIN] } });
    if (path === "/api/challenges/1")
      return route.fulfill({
        json: {
          id: 1,
          title: "Best hack",
          description: "",
          criteria: "",
          prizes: [],
          judging_panel_criteria: [],
          title_i18n: null,
          description_i18n: null,
          criteria_i18n: null,
          max_presentation_seconds: 300,
          max_in_waiting_area: 2,
          visibility: "visible",
          available_from: null,
        },
      });
    if (path === "/api/challenges/1/winners/publication") {
      if (route.request().method() === "PUT") publishAt = route.request().postDataJSON().publishAt;
      return route.fulfill({ json: { publishAt, publishedAt: null } });
    }
    if (path === "/api/challenges/1/winners")
      return route.fulfill({
        json: { winners: [{ rank: 1, repoId: 10, repoName: "Neural Beans" }] },
      });
    if (path === "/api/repos")
      return route.fulfill({
        json: { repos: [{ id: 10, name: "Neural Beans", challenges: [{ id: 1 }] }] },
      });
    return route.fulfill({ json: { items: [], total: 0 } });
  });
  await page.goto("/challenges/1?tab=winners");
  await expect(page.getByText("Neural Beans", { exact: true })).toBeVisible();
  const date = page.getByRole("textbox", { name: "Publish winners at", exact: true });
  await date.fill("2027-03-07");
  await date.locator("..").locator("input[type=time]").fill("18:00");
  const scope = page.locator("section").filter({ has: date });
  await scope.getByRole("button", { name: "Save changes" }).click();
  await expect.poll(() => publishAt).not.toBeNull();
  await expect(page.getByText("Winners remain private until publication.")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await mkdir("/tmp/hackos-1011-screenshots", { recursive: true });
  await page.screenshot({
    path: `/tmp/hackos-1011-screenshots/winners-${info.project.name}.png`,
    fullPage: true,
  });
});
