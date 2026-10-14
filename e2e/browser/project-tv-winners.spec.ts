import { mkdir } from "node:fs/promises";
import { expect, test } from "./fixtures";

test("TV reveals published winners without a mode change", async ({ page }, info) => {
  let published = false;
  let reads = 0;
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/tv/winners") {
      reads += 1;
      return route.fulfill({
        json: published
          ? {
              winners: [
                {
                  challengeId: 1,
                  challengeTitle: "Best hack",
                  rank: 1,
                  repoId: 10,
                  repoName: "Neural Beans",
                },
              ],
            }
          : {},
      });
    }
    if (path === "/api/tv/mode")
      return route.fulfill({
        json: { mode: "live", payload: null, source: "manual", broadcastAt: null },
      });
    if (path === "/api/public/event")
      return route.fulfill({
        json: {
          name: "HackUDC",
          timezone: "Europe/Madrid",
          hackingStartsAt: null,
          hackingEndsAt: null,
          judgingStartsAt: null,
          judgingEndsAt: null,
          showStartCountdown: false,
        },
      });
    if (path === "/api/tv/config") return route.fulfill({ json: { language: "en", wifi: null } });
    if (path === "/api/tv/rooms") return route.fulfill({ json: { rooms: [] } });
    if (path === "/api/me")
      return route.fulfill({ status: 401, json: { error: { code: "unauthenticated" } } });
    return route.fulfill({ json: { items: [] } });
  });
  await page.goto("/tv");
  await expect.poll(() => reads).toBeGreaterThan(0);
  await expect(page.getByText("Neural Beans", { exact: true })).toHaveCount(0);
  published = true;
  await expect(page.getByText("Neural Beans", { exact: true }).first()).toBeVisible({
    timeout: 20000,
  });
  await expect(page.getByText("Best hack", { exact: true }).first()).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight),
  ).toBe(true);
  await mkdir("/tmp/hackos-1011-screenshots", { recursive: true });
  await page.screenshot({
    path: `/tmp/hackos-1011-screenshots/tv-winners-${info.project.name}.png`,
  });
});
