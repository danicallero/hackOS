import { mkdir } from "node:fs/promises";
import { CAPABILITIES } from "../../packages/shared/src/capabilities";
import { expect, shellUser, test } from "./fixtures";

// H54/H56: batch selection remains independent by source and by form.
test("application export groups support bulk, partial, filtered and keyboard selection", async ({
  page,
}, info) => {
  if (info.project.name === "chromium") await page.setViewportSize({ width: 1440, height: 1100 });
  await page.addInitScript(() => {
    localStorage.setItem("hackos-language", "en");
    localStorage.setItem("hackos.cookie-notice.dismissed", "true");
  });
  const field = (key: string, label: string) => ({
    key,
    label: { en: label, es: label, gl: label },
  });
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/me/public-profile") return route.fallback();
    const data =
      path === "/api/me"
        ? {
            ...shellUser,
            capabilities: [
              CAPABILITIES.APPLICATIONS_MANAGE,
              CAPABILITIES.APPLICATIONS_REVIEW,
              CAPABILITIES.EXPORTS_RUN,
            ],
          }
        : path === "/api/applications/1"
          ? {
              id: 1,
              name: "Hacker",
              template: [],
              sections: [],
              grants_role_ids: [],
              description: null,
              open_at: null,
              close_at: null,
              capacity: 100,
              confirmation_window_hours: 48,
              ask_shirt_size: false,
              ask_food_intolerances: false,
              current_form_version: 1,
              has_confirmed_responses: false,
            }
          : path === "/api/applications/1/responses"
            ? { responses: [] }
            : path === "/api/exports/applications/catalog"
              ? {
                  profile: [field("name", "Name"), field("email", "Email")],
                  metadata: [field("status", "Status")],
                  applications: [
                    {
                      id: 1,
                      name: "Hacker",
                      fields: [
                        field("university", "University"),
                        field("motivation", "Why do you want to join?"),
                      ],
                    },
                    { id: 2, name: "Volunteer", fields: [field("availability", "Availability")] },
                  ],
                }
              : {};
    return route.fulfill({ json: data });
  });
  await page.goto("/applications/1?tab=review");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByRole("menuitem", { name: "Application data (CSV)" }).click();
  const panel = page.getByRole("dialog");
  const profile = panel.getByRole("checkbox", { name: "Profile fields" });
  const hacker = panel.getByRole("checkbox", { name: "Hacker" });
  await expect(profile).toBeChecked();
  await expect(panel.getByText("6 fields selected")).toBeVisible();
  await profile.click();
  await expect(panel.getByText("4 fields selected")).toBeVisible();
  const expand = panel.getByRole("button", { name: "Choose fields: Profile fields", exact: true });
  await expand.focus();
  await page.keyboard.press("Enter");
  await expect(expand).toHaveAttribute("aria-expanded", "true");
  await panel.getByRole("checkbox", { name: "Name name", exact: true }).click();
  await expect(profile).toHaveAttribute("aria-checked", "mixed");
  await expect(hacker).toBeChecked();
  await profile.click();
  await expect(profile).toBeChecked();
  const search = panel.getByRole("textbox", { name: "Filter fields" });
  await search.fill("University");
  await expect(
    panel.getByRole("checkbox", { name: "University university", exact: true }),
  ).toBeVisible();
  await hacker.click();
  await search.fill("");
  await expect(hacker).toHaveAttribute("aria-checked", "mixed");
  await expect(panel.getByRole("checkbox", { name: "Volunteer" })).toBeChecked();
  await expect(panel.getByText("5 fields selected")).toBeVisible();
  await expand.click();
  await hacker.scrollIntoViewIfNeeded();
  await mkdir("artifacts/application-export", { recursive: true });
  await panel.screenshot({ path: `artifacts/application-export/grouped-${info.project.name}.png` });
  await panel.getByRole("button", { name: "Choose fields: Hacker", exact: true }).click();
  await expect(
    panel.getByRole("checkbox", { name: "University university", exact: true }),
  ).not.toBeChecked();
  await expect(
    panel.getByRole("checkbox", { name: "Why do you want to join? motivation", exact: true }),
  ).toBeChecked();
  await panel.screenshot({
    path: `artifacts/application-export/expanded-${info.project.name}.png`,
  });
});
