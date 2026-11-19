import { devices } from "@playwright/test";
import { CAPABILITIES } from "../../packages/shared/src/capabilities";
import { expect, shellUser, test } from "./fixtures";

// H48: on phones the sidebar button floats over the top-left of the canvas;
// a hero's back-link row must share its height so the title starts below it.
const { defaultBrowserType: _browser, ...pixel } = devices["Pixel 7"];
test.use(pixel);
// Touch emulation (coarse pointer, touch-sized controls) is a Chromium device profile.
test.skip(({ browserName }) => browserName !== "chromium");

const label = (en: string) => ({ en, es: en, gl: en });
const project = {
  id: 10,
  name: "Tidepool Sensors",
  description: null,
  githubUrl: null,
  demoUrl: null,
  submissionStatus: "draft",
  canEdit: true,
  canSubmit: false,
  canInvite: false,
  presentationTimingPreference: "no_preference",
  revision: 0,
  formVersion: 1,
  template: [
    {
      key: "about",
      label: label("About"),
      kind: "textarea",
      required: false,
      project_description: true,
    },
  ],
  sections: [],
  responses: {},
  files: [],
  members: [{ userId: 1, name: "Alex Example", status: "active", photoUrl: null }],
  challenges: [],
};

test("project hero title clears the floating sidebar button", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("hackos-language", "en");
    localStorage.setItem("hackos.cookie-notice.dismissed", "true");
  });
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/me/public-profile") return route.fallback();
    if (path === "/api/me")
      return route.fulfill({
        json: { ...shellUser, hasProject: true, capabilities: [CAPABILITIES.PROJECTS_EDIT] },
      });
    if (path === "/api/me/projects/10") return route.fulfill({ json: project });
    return route.fulfill({ json: { items: [], total: 0, intolerances: [], sizes: [] } });
  });
  await page.goto("/my-project/10");
  const title = page.getByRole("heading", { name: "Tidepool Sensors", exact: true });
  await expect(title).toBeVisible();
  const toggle = page.locator('[data-sidebar="trigger"]:visible').first();
  await expect(toggle).toBeVisible();
  const button = await toggle.boundingBox();
  const back = await page.locator("[data-hero-bleed] [data-back-link]").boundingBox();
  const heading = await title.boundingBox();
  if (!button || !back || !heading) throw new Error("missing geometry");
  expect(heading.y).toBeGreaterThanOrEqual(button.y + button.height);
  // The back link sits on the button's row, beside it.
  expect(Math.abs(back.y + back.height / 2 - (button.y + button.height / 2))).toBeLessThanOrEqual(
    2,
  );
});
