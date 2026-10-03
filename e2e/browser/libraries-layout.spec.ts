import { CAPABILITIES } from "../../packages/shared/src/capabilities";
import { expect, shellUser, test } from "./fixtures";

// H12/H25: catalogue managers share a separate, single-row search/add toolbar.
for (const tab of ["universities", "degrees", "intolerances"] as const) {
  test(`library ${tab} keeps search and add together`, async ({ page }) => {
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      let body: unknown = { items: [], total: 0 };
      if (url.pathname === "/api/me")
        body = { ...shellUser, capabilities: [CAPABILITIES.ADMIN_ALL] };
      if (["/api/public/universities", "/api/public/degrees"].includes(url.pathname)) {
        const key = url.pathname.endsWith("degrees") ? "degrees" : "universities";
        const entries = [
          { id: 1, name: "Alpha" },
          { id: 2, name: "Beta" },
        ];
        const query = url.searchParams.get("q")?.toLowerCase() ?? "";
        body = { [key]: entries.filter((entry) => entry.name.toLowerCase().includes(query)) };
      }
      if (url.pathname === "/api/public/food-intolerances")
        body = {
          intolerances: [
            { id: 1, label: { en: "Alpha", es: "Alpha", gl: "Alpha" }, description: null },
            { id: 2, label: { en: "Beta", es: "Beta", gl: "Beta" }, description: null },
          ],
        };
      await route.fulfill({ json: body });
    });
    await page.goto(`/settings/libraries?tab=${tab}`);
    const cookies = page.locator('aside[aria-labelledby="cookie-notice-title"]');
    await expect(cookies).toBeVisible();
    await cookies.locator("button").first().click();
    const panel = page.getByRole("tabpanel");
    const search = panel.getByRole("searchbox");
    const add = panel.getByRole("button", { name: /^Add (university|degree|intolerance)$/ });
    await expect(panel.getByRole("cell", { name: /Alpha/ }).first()).toBeVisible();
    const inputBounds = await search.boundingBox();
    const addBounds = await add.boundingBox();
    expect(inputBounds).not.toBeNull();
    expect(addBounds).not.toBeNull();
    if (inputBounds && addBounds)
      expect(
        Math.abs(inputBounds.y + inputBounds.height / 2 - addBounds.y - addBounds.height / 2),
      ).toBeLessThanOrEqual(1);
    if (test.info().project.name === "mobile-chromium")
      expect((await add.innerText()).trim()).toBe("Add");
    await page.screenshot({
      path: `artifacts/settings/library-${tab}-${test.info().project.name}.png`,
      fullPage: true,
    });
    await search.fill("alpha");
    await expect(panel.getByRole("cell", { name: /Beta/ })).toHaveCount(0);
    await panel.getByRole("button", { name: "Clear search", exact: true }).click();
    await expect(search).toBeFocused();
    await expect(panel.getByRole("cell", { name: /Beta/ }).first()).toBeVisible();
    await add.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
}
