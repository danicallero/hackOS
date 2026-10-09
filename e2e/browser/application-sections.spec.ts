import { CAPABILITIES } from "../../packages/shared/src/capabilities";
import { expect, shellUser, test } from "./fixtures";

// H11: exiting a section has an explicit pointer target and keyboard alternative.
for (const width of [1440, 393]) {
  test(`move a question out of a section and back without losing its data (${width})`, async ({
    page,
  }, info) => {
    test.skip(info.project.name !== "chromium", "Pointer destination regression");
    await page.setViewportSize({ width, height: 1000 });
    let persistedTemplate: Record<string, unknown>[] | null = null;
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/applications/1" && route.request().method() === "PATCH") {
        persistedTemplate = route.request().postDataJSON().template;
      }
      const data =
        path === "/api/me"
          ? {
              ...shellUser,
              capabilities: [
                CAPABILITIES.APPLICATIONS_MANAGE,
                CAPABILITIES.APPLICATIONS_REVIEW,
                CAPABILITIES.APPLICATIONS_DECIDE,
              ],
            }
          : path === "/api/applications/1"
            ? {
                id: 1,
                name: "Participant form",
                template: persistedTemplate ?? [
                  {
                    key: "alpha",
                    label: { en: "Alpha field", es: "Alpha field", gl: "Alpha field" },
                    kind: "text",
                    required: false,
                    section_key: "about",
                  },
                ],
                sections: [
                  { key: "about", title: { en: "About you", es: "About you", gl: "About you" } },
                ],
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
              : {};
      await route.fulfill({ json: data });
    });

    // The cookie notice mounts after hydration and, at 393 px, covers the save
    // button; start with it dismissed instead of racing its appearance.
    await page.addInitScript(() =>
      window.localStorage.setItem("hackos.cookie-notice.dismissed", "true"),
    );
    await page.goto("/applications/1?tab=builder");
    // Wait for the loaded form: the builder remounts its rows when data arrives.
    await expect(page.getByText("Alpha field", { exact: true })).toBeVisible();
    const handle = page.getByRole("button", { name: "Drag to reorder", exact: true });
    await expect(handle).toBeVisible();
    await handle.scrollIntoViewIfNeeded();
    const source = (await handle.boundingBox())!;
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
    await page.mouse.down();
    await page.mouse.move(source.x + 30, source.y + 30, { steps: 5 });
    const destination = page.getByText("Drop outside, after About you", { exact: true });
    await destination.scrollIntoViewIfNeeded();
    const target = (await destination.boundingBox())!;
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 20 });
    await page.mouse.up();
    // Let the shared 200 ms drop animation and sensor click suppression settle.
    await page.waitForTimeout(250);
    const section = page.getByRole("region", { name: "About you", exact: true });
    await expect(section.getByText("Alpha field", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Save questions", exact: true }).click();
    await page.getByRole("button", { name: "Save anyway", exact: true }).click();
    await expect.poll(() => persistedTemplate?.[0]?.after_section_key).toBe("about");
    expect(persistedTemplate?.[0]?.section_key).toBeUndefined();
    await page.reload();
    await expect(section.getByText("Alpha field", { exact: true })).toHaveCount(0);
    await page.screenshot({
      path: `artifacts/surfaces/application-after-section-${width}.png`,
      fullPage: true,
    });
    await page.getByText("Alpha field", { exact: true }).click();
    await page.getByRole("combobox", { name: "Sections", exact: true }).click();
    await page.getByRole("option", { name: "About you", exact: true }).click();
    await expect(
      section.getByRole("textbox", { name: "Applicant question", exact: true }),
    ).toHaveValue("Alpha field");
  });
}
