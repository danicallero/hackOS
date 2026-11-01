import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { CAPABILITIES } from "../../packages/shared/src/capabilities";
import { expect, shellUser, test } from "./fixtures";

const event = {
  name: "Accessibility audit event",
  tagline: "A welcoming event for everyone",
  timezone: "Europe/Madrid",
  hackingStartsAt: null,
  hackingEndsAt: null,
  judgingStartsAt: null,
  judgingEndsAt: null,
  showStartCountdown: false,
};

const activity = {
  id: 1,
  title: "Inclusive design workshop",
  description: "Build usable interfaces together.",
  location: "Main hall",
  type: "workshop",
  startsAt: "2099-10-13T10:00:00Z",
  endsAt: "2099-10-13T11:00:00Z",
  visibility: "shown",
  publishAt: null,
  audiences: ["participant"],
  primaryLanguage: "en",
  titleI18n: {},
  descriptionI18n: {},
};

async function auditFixture(page: Page, authenticated: boolean, theme: string) {
  await page.addInitScript((theme) => {
    localStorage.setItem("hackos-language", "en");
    localStorage.setItem("hackos.cookie-notice.dismissed", "true");
    localStorage.setItem("theme", theme);
  }, theme);
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/me/public-profile") return route.fallback();
    if (path === "/api/me") {
      return route.fulfill({
        status: authenticated ? 200 : 401,
        json: authenticated
          ? { ...shellUser, capabilities: [CAPABILITIES.ADMIN_ALL] }
          : { error: { code: "unauthenticated" } },
      });
    }
    if (path === "/api/public/event") return route.fulfill({ json: event });
    if (path === "/api/roles" || path === "/api/role-templates") return route.fulfill({ json: [] });
    if (path === "/api/users")
      return route.fulfill({
        json: {
          users: [
            {
              ...shellUser,
              id: 22,
              name: "Alex",
              surname: "Roster",
              email: "alex@example.com",
              foodIntolerances: [],
              createdAt: "2026-10-01T12:00:00Z",
            },
          ],
          total: 1,
        },
      });
    if (path === "/api/schedule" || path === "/api/public/activities")
      return route.fulfill({ json: { items: [activity] } });
    if (path === "/api/me/notification-preferences")
      return route.fulfill({
        json: {
          channels: ["in_app", "email", "push"],
          mandatoryCategories: ["queue"],
          emailOptInCategories: [],
          hasPushDevice: false,
          onboardingRequired: false,
          overrides: [{ category: "schedule:type:meal", channel: "in_app", enabled: true }],
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
    return route.fulfill({ json: { items: [], total: 0, applications: [] } });
  });
}

for (const path of ["/", "/login", "/inbox?tab=preferences", "/timetable"]) {
  test(`${path} retains content at narrow width and enlarged text`, async ({ page }, info) => {
    await auditFixture(page, path.startsWith("/inbox"), "light");
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-locale-ready", "true");
    await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await page.screenshot({
      path: `/tmp/tetra-reflow-${path.replace(/\W/g, "-")}-${info.project.name}.png`,
      fullPage: true,
    });
    const clippedControls = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("a,button,input,select,textarea")]
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            getComputedStyle(element).visibility === "visible" &&
            !element.closest('[inert],[aria-hidden="true"]') &&
            (rect.left < -1 || rect.right > innerWidth + 1)
          );
        })
        .map((element) => ({
          name: element.getAttribute("aria-label") ?? element.textContent?.trim(),
          tag: element.tagName,
        })),
    );
    expect(clippedControls).toEqual([]);
  });
}

// H1–H5/H8/H47/H49/H51: rendered checks complement the keyboard interaction
// specs. These deterministic states do not certify every route or user content.
for (const theme of ["light", "dark"]) {
  for (const scenario of [
    { path: "/", authenticated: false, ready: "Accessibility audit event" },
    { path: "/login", authenticated: false, form: true },
    { path: "/signup", authenticated: false, form: true },
    { path: "/forgot-password", authenticated: false, form: true },
    { path: "/terms", authenticated: false },
    { path: "/privacy", authenticated: false },
    { path: "/design-system", authenticated: false },
    { path: "/timetable", authenticated: false },
    { path: "/event", authenticated: true, ready: "Challenges and prizes" },
    { path: "/inbox", authenticated: true },
    { path: "/inbox?tab=preferences", authenticated: true, ready: "Notification channels" },
    { path: "/users", authenticated: true, text: "Alex Roster" },
    { path: "/permissions", authenticated: true },
    { path: "/schedule", authenticated: true, text: "Inclusive design workshop" },
  ]) {
    test(`${scenario.path} exposes accessible rendered structure in ${theme}`, async ({
      page,
    }, info) => {
      await auditFixture(page, scenario.authenticated, theme);
      await page.goto(scenario.path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      if ("form" in scenario) await expect(page.getByRole("textbox").first()).toBeVisible();
      if ("text" in scenario)
        await expect(page.getByText(scenario.text, { exact: true }).first()).toBeVisible();
      if ("ready" in scenario)
        await expect(
          page.getByRole("heading", { name: scenario.ready, exact: true }),
        ).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("data-locale-ready", "true");
      await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${theme}\\b`));
      await expect(page.getByRole("main")).toHaveCount(1);
      const results = await new AxeBuilder({ page }).analyze();
      await info.attach("accessibility-results", {
        body: JSON.stringify(
          { violations: results.violations, incomplete: results.incomplete },
          null,
          2,
        ),
        contentType: "application/json",
      });
      expect(
        results.violations.map(({ id, nodes }) => ({
          id,
          nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })),
        })),
      ).toEqual([]);
    });
  }
}
