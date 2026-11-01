import type { Locator, Page } from "@playwright/test";
import { expect, shellUser, test } from "./fixtures";

async function fixture(page: Page, authenticated = true) {
  await page.addInitScript(() => {
    // Exclude Next's development toolbar, which is absent from production and
    // traps Firefox keyboard traversal inside its shadow root.
    const ignoreDevToolbar = () => {
      for (const portal of document.querySelectorAll<HTMLElement>("nextjs-portal"))
        portal.inert = true;
    };
    new MutationObserver(ignoreDevToolbar).observe(document, { childList: true, subtree: true });
    localStorage.setItem("hackos-language", "en");
    localStorage.setItem("hackos.cookie-notice.dismissed", "true");
  });
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/me/public-profile") return route.fallback();
    if (path === "/api/me")
      return route.fulfill({
        status: authenticated ? 200 : 401,
        json: authenticated ? { ...shellUser, capabilities: ["*"] } : {},
      });
    if (path === "/api/public/event")
      return route.fulfill({
        json: {
          name: "Navigation test event",
          tagline: "A public event",
          timezone: "Europe/Madrid",
          hackingStartsAt: null,
          hackingEndsAt: null,
          showStartCountdown: false,
          judgingStartsAt: null,
          judgingEndsAt: null,
        },
      });
    if (path === "/api/public/applications")
      return route.fulfill({
        json: {
          applications: [
            { id: 1, name: "Hacker application", granted_role_name: "Participant", close_at: null },
          ],
        },
      });
    if (path === "/api/me/notifications/preferences")
      return route.fulfill({ json: { preferences: [] } });
    return route.fulfill({ json: { items: [], total: 0, applications: [] } });
  });
}

const tabKey = () => (test.info().project.name === "webkit" ? "Alt+Tab" : "Tab");

async function tabTo(page: Page, target: Locator) {
  // Traverse backwards to earlier controls rather than depending on browser-chrome
  // Tab wrapping, which differs between headless engines.
  const backwards = await target.evaluate((element) => {
    const active = document.activeElement;
    return (
      active &&
      active !== document.body &&
      Boolean(active.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_PRECEDING)
    );
  });
  const key = backwards ? `Shift+${tabKey()}` : tabKey();
  for (let attempt = 0; attempt < 90; attempt++) {
    await page.keyboard.press(key);
    if (await target.evaluate((element) => element === document.activeElement)) return;
  }
  throw new Error(
    `Keyboard did not reach ${(await target.getAttribute("href")) ?? (await target.textContent())}`,
  );
}

test("public sections have keyboard jump links and unobscured focus targets", async ({
  page,
}, info) => {
  if (info.project.name === "mobile-chromium")
    await page.setViewportSize({ width: 320, height: 640 });
  await fixture(page, false);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Navigation test event" })).toBeVisible();
  await page.screenshot({ path: `/tmp/tetra-navigation-landing-${info.project.name}.png` });
  await page.keyboard.press(tabKey());
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  const navigation = page.getByRole("navigation", { name: "On this page" });
  for (const name of [
    "Open applications",
    "Schedule",
    "Challenges and prizes",
    "Project gallery",
    "Sponsors",
  ]) {
    const link = navigation.getByRole("link", { name, exact: true });
    await tabTo(page, link);
    await page.keyboard.press("Enter");
    const heading = page.getByRole("heading", { name, exact: true });
    await expect(heading).toBeFocused();
    expect((await heading.boundingBox())?.y).toBeGreaterThanOrEqual(64);
  }
  await expect(page.getByRole("main")).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `/tmp/tetra-navigation-public-${info.project.name}.png` });
});

test("expanded and icon sidebar reach every Access and audit child with Tab", async ({
  page,
}, info) => {
  test.skip(info.project.name === "mobile-chromium", "Desktop rail coverage");
  await page.setViewportSize({ width: 1280, height: 600 });
  await fixture(page);
  await page.goto("/inbox");
  const disclosure = page.getByRole("button", { name: "Access and audit", exact: true });
  await tabTo(page, disclosure);
  await page.keyboard.press("Enter");
  await expect(disclosure).toHaveAttribute("aria-expanded", "true");
  for (const name of ["Users", "Permissions", "Reports", "Audit log"]) {
    const link = page.getByRole("link", { name, exact: true });
    await tabTo(page, link);
    await expect(link).toBeInViewport();
  }
  await page.screenshot({ path: `/tmp/tetra-navigation-expanded-${info.project.name}.png` });
  const trigger = page.getByRole("button", { name: "Toggle sidebar", exact: true }).first();
  await tabTo(page, trigger);
  await page.keyboard.press("Enter");
  for (const name of ["Users", "Permissions", "Reports", "Audit log"]) {
    const link = page.getByRole("link", { name, exact: true });
    await tabTo(page, link);
    await expect(link).toBeInViewport();
  }
  await page.screenshot({ path: `/tmp/tetra-navigation-rail-${info.project.name}.png` });
});

test("shell has one main, a skip link, route focus and a collapsible active workspace", async ({
  page,
}, info) => {
  test.skip(info.project.name === "mobile-chromium", "Desktop disclosure coverage");
  await fixture(page);
  await page.goto("/event");
  await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible();
  await expect(page.getByRole("main")).toHaveCount(1);
  await page.keyboard.press(tabKey());
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  const disclosure = page.getByRole("button", { name: "Access and audit", exact: true });
  await tabTo(page, disclosure);
  await page.keyboard.press("Space");
  await tabTo(page, page.getByRole("link", { name: "Audit log", exact: true }));
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/audit$/);
  await expect(page.getByRole("main")).toBeFocused();
  await tabTo(page, disclosure);
  await page.keyboard.press("Space");
  await expect(disclosure).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("link", { name: "Users", exact: true })).toHaveCount(0);
});

test("320px sidebar sheet exposes all destinations and closes on keyboard navigation", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await fixture(page);
  await page.goto("/event");
  const trigger = page.getByRole("button", { name: "Toggle sidebar", exact: true });
  await tabTo(page, trigger);
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Access and audit", exact: true })).toHaveCount(
    0,
  );
  for (const name of ["Users", "Permissions", "Reports", "Audit log"]) {
    const link = dialog.getByRole("link", { name, exact: true });
    await tabTo(page, link);
    await expect(link).toBeInViewport();
  }
  await page.screenshot({ path: `/tmp/tetra-navigation-narrow-${info.project.name}.png` });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/audit$/);
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("main")).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("public forward routes reset focus and scroll while Back restores the reading position", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 600 });
  await fixture(page, false);
  await page.goto("/privacy");
  const main = page.getByRole("main");
  await expect(main).toBeVisible();
  await expect(main).not.toBeFocused();
  const terms = page
    .getByRole("navigation")
    .getByRole("link", { name: "Terms and conditions", exact: true });
  await tabTo(page, terms);
  const readingPosition = await page.evaluate(() => window.scrollY);
  expect(readingPosition).toBeGreaterThan(100);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/terms$/);
  await expect(main).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.goBack();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect
    .poll(async () => Math.abs((await page.evaluate(() => window.scrollY)) - readingPosition))
    .toBeLessThan(3);
  await expect(main).toBeFocused();
});

test("component preview uses shared public chrome and a working skip target", async ({ page }) => {
  await fixture(page, false);
  await page.goto("/design-system");
  await expect(page.getByRole("main")).toHaveCount(1);
  await page.keyboard.press(tabKey());
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  await expect(page.getByRole("link", { name: "hackOS — Back to home" })).toBeVisible();
});

test("landing section links reflow and clear the wrapped header with enlarged text", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await fixture(page, false);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Navigation test event" })).toBeVisible();
  await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
  const jump = page
    .getByRole("navigation", { name: "On this page" })
    .getByRole("link", { name: "Open applications", exact: true });
  await tabTo(page, jump);
  await page.keyboard.press("Enter");
  const heading = page.getByRole("heading", { name: "Open applications", exact: true });
  await expect(heading).toBeFocused();
  const headerBottom = (await page.getByRole("banner").boundingBox())?.height ?? 0;
  expect((await heading.boundingBox())?.y).toBeGreaterThanOrEqual(headerBottom);
  for (const control of await page.getByRole("link").all()) {
    if (!(await control.isVisible())) continue;
    // The skip link stays clipped (sr-only) until it receives focus.
    if (await control.evaluate((element) => element.matches(".sr-only:not(:focus)"))) continue;
    const bounds = await control.boundingBox();
    expect(bounds?.x).toBeGreaterThanOrEqual(-1);
    expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(321);
  }
  await page.screenshot({
    path: `/tmp/tetra-navigation-enlarged-${info.project.name}.png`,
    fullPage: true,
  });
});
