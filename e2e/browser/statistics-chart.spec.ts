import { CAPABILITIES } from "../../packages/shared/src/capabilities";
import { expect, shellUser, test } from "./fixtures";

// H27: native legend linkage and theme changes must preserve chart paint.
test("statistics legends show counts and follow the active theme", async ({ page }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem("hackos.cookie-notice.dismissed", "true"));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.route("**/api/**", async (route) => {
    if (new URL(route.request().url()).pathname === "/api/me/public-profile") {
      return route.fallback();
    }
    const path = new URL(route.request().url()).pathname;
    const json =
      path === "/api/me"
        ? { ...shellUser, capabilities: [CAPABILITIES.LOGISTICS_STATS] }
        : path === "/api/statistics/scopes"
          ? {
              scopes: [
                {
                  key: "application:1",
                  kind: "application",
                  id: 1,
                  name: "Participants",
                  panelKeys: ["shirt-sizes", "food-intolerances"],
                },
              ],
            }
          : path === "/api/statistics/query"
            ? {
                panel_keys: ["shirt-sizes", "food-intolerances"],
                shirt_sizes_confirmed: [
                  { value: "M", n: 10 },
                  { value: "L", n: 2 },
                ],
                food_intolerances_confirmed: [{ value: "None", n: 8 }],
              }
            : {};
    await route.fulfill({ json });
  });
  await page.goto("/logistics/stats?tab=before");
  const notice = page.locator('aside[aria-labelledby="cookie-notice-title"]');
  if (await notice.isVisible()) await notice.locator("button").click();
  const chart = page.getByRole("img", { name: "T-shirt size distribution", exact: true });
  const legend = chart.locator("svg text").filter({ hasText: /^M$/ }).last();
  await expect(legend).toBeVisible();
  for (const theme of ["light", "dark", "light"] as const) {
    await page.evaluate(
      (value) => document.documentElement.classList.toggle("dark", value === "dark"),
      theme,
    );
    await expect(legend).toHaveAttribute(
      "fill",
      theme === "dark" ? "rgb(250,250,250)" : "rgb(3,8,70)",
    );
    // H27: hover the painted SVG text, using its own coordinate transform.
    // WebKit's actionability quad can overlap the adjacent legend marker.
    const legendPoint = await legend.evaluate((element) => {
      const text = element as SVGGraphicsElement;
      const box = text.getBBox();
      const matrix = text.getScreenCTM();
      if (!matrix) throw new Error("Legend is not painted");
      const point = new DOMPoint(box.x + box.width / 2, box.y + box.height / 2).matrixTransform(
        matrix,
      );
      return { x: point.x, y: point.y };
    });
    await page.mouse.move(legendPoint.x, legendPoint.y);
    await expect(chart.locator("div").filter({ hasText: /^10$/ }).last()).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`statistics-${theme}-legend.png`) });
    await page.mouse.move(10, 10);
  }
  const point = await chart.locator("svg").evaluate((svg) => {
    const bar = [...svg.querySelectorAll("path, rect")].find((element) => {
      if (element.closest("defs")) return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 100 && rect.height >= 15 && rect.height <= 25;
    });
    if (!bar) throw new Error("No painted statistic bar");
    const rect = bar.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  });
  await page.mouse.move(point.x, point.y);
  await expect(legend).toHaveCSS("font-weight", "700");
  await page.screenshot({ path: testInfo.outputPath("statistics-chart-hover.png") });
});
