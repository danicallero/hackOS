import { mkdir } from "node:fs/promises";
import { CAPABILITIES } from "../../packages/shared/src/capabilities";
import { expect, shellUser, test } from "./fixtures";

test("project form reuses section builder and saves without application reserved keys", async ({
  page,
}, info) => {
  let saved: Record<string, unknown> | null = null;
  const template = [
    {
      key: "summary",
      label: { en: "Summary", es: "Resumen", gl: "Resumo" },
      kind: "textarea",
      required: true,
      section_key: "content",
    },
  ];
  const sections = [{ key: "content", title: { en: "Project", es: "Proyecto", gl: "Proxecto" } }];
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
      return route.fulfill({ json: { ...shellUser, capabilities: [CAPABILITIES.PROJECTS_EDIT] } });
    if (path === "/api/projects/form") {
      if (route.request().method() === "PUT") saved = route.request().postDataJSON();
      return route.fulfill({ json: { version: 1, template, sections, ...saved } });
    }
    return route.fulfill({ json: { items: [], total: 0, intolerances: [], sizes: [] } });
  });
  await page.goto("/projects/form");
  await expect(
    page.getByRole("heading", { name: "Form fields", exact: true }).first(),
  ).toBeVisible();
  // H16: application-only authoring controls stay out of the project builder.
  await page.getByRole("button", { name: "Edit: Summary" }).click();
  await page.getByText("Advanced", { exact: true }).click();
  await expect(page.locator("input[id^=field-key-]")).toBeVisible();
  await expect(page.getByText("Integrate into Logistics statistics")).toHaveCount(0);
  await expect(page.getByText("Anonymous audit data")).toHaveCount(0);
  await page.getByRole("button", { name: "Add section", exact: true }).first().click();
  await page.getByRole("button", { name: "Save questions", exact: true }).click();
  await expect.poll(() => saved !== null).toBe(true);
  expect(saved).toHaveProperty("sections");
  expect(saved).not.toHaveProperty("field_renames");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await mkdir("/tmp/hackos-1011-screenshots", { recursive: true });
  await page.screenshot({
    path: `/tmp/hackos-1011-screenshots/builder-${info.project.name}.png`,
    fullPage: true,
  });
});
