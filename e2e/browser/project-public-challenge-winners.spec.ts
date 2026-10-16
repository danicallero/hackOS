import { mkdir } from "node:fs/promises";
import { expect, test } from "./fixtures";

// H60: the public challenge page shows winners only once the published read returns them.
test("public challenge page shows published winners only after reveal", async ({ page }, info) => {
  let revealed = false;
  await page.addInitScript(() => {
    localStorage.setItem("hackos-language", "en");
    localStorage.setItem("hackos.cookie-notice.dismissed", "true");
  });
  await page.route("**/api/**", (route) => {
    if (new URL(route.request().url()).pathname === "/api/me/public-profile") {
      return route.fallback();
    }
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/public/challenges/1/winners")
      return route.fulfill({
        json: revealed
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
    if (path === "/api/public/challenges")
      return route.fulfill({
        json: {
          items: [
            {
              id: 1,
              title: { en: "Best hack", es: "Mejor hack", gl: "Mellor hack" },
              description: { en: "Build it", es: "Constrúyelo", gl: "Constrúeo" },
              criteria: { en: "", es: "", gl: "" },
              prizes: [],
              availableFrom: null,
              enterprise: {
                id: 1,
                name: "Acme",
                logoUrl: null,
                logoNegativeUrl: null,
                website: null,
              },
            },
          ],
        },
      });
    if (path === "/api/public/applications") return route.fulfill({ json: { applications: [] } });
    return route.fulfill({ json: {} });
  });
  await page.goto("/challenge/1");
  await expect(page.getByRole("heading", { name: "Best hack" }).first()).toBeVisible();
  await expect(page.getByText("Neural Beans")).toHaveCount(0);
  revealed = true;
  await page.reload();
  const winner = page.getByRole("link", { name: "1 · Neural Beans" });
  await expect(winner).toBeVisible();
  await expect(winner).toHaveAttribute("href", "/gallery/10");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await mkdir("/tmp/hackos-1011-screenshots", { recursive: true });
  await page.screenshot({
    path: `/tmp/hackos-1011-screenshots/public-challenge-winners-${info.project.name}.png`,
    fullPage: true,
  });
});
