import { CAPABILITIES } from "../../packages/shared/src/capabilities";
import { expect, shellUser, test } from "./fixtures";

// H13/H14: review chrome leaves room for answers and preserves export access.
for (const width of [320, 393, 1440]) {
  for (const theme of ["light", "dark"] as const) {
    test(`review layout and export at ${width}px in ${theme}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 844 });
      await page.addInitScript((appearance) => {
        localStorage.setItem("theme", appearance);
        localStorage.setItem("hackos.cookie-notice.dismissed", "true");
      }, theme);
      const section = {
        key: "personal",
        title: {
          en: "Personal information",
          es: "Información personal",
          gl: "Información persoal",
        },
      };
      const template = Array.from({ length: 8 }, (_, index) => ({
        key: `answer_${index}`,
        kind: "text",
        section_key: section.key,
        label: {
          en: `Question ${index + 1}`,
          es: `Pregunta ${index + 1}`,
          gl: `Pregunta ${index + 1}`,
        },
      }));
      const response = {
        id: 10,
        user_id: 22,
        name: "Avery Applicant",
        email: "avery@example.test",
        status: "review",
        responses: Object.fromEntries(template.map((field) => [field.key, "An answer to read"])),
        shirt_size: null,
        food_intolerances: [],
        food_intolerance_notes: null,
        staff_notes: null,
        submitted_at: "2026-11-03T10:00:00Z",
        decision_sent_at: null,
        confirmation_expires_at: null,
        confirmed_at: null,
        declined_at: null,
        avg_score: "3.66666667",
        review_count: 3,
        reviews: [1, 2, 3].map((id) => ({
          author_id: id,
          author_name: `Reviewer ${id}`,
          score: 4,
          notes: `Review notes ${id}`,
          updated_at: "2026-11-03T10:00:00Z",
        })),
      };
      await page.route("**/api/**", async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path === "/api/me/public-profile") return route.fallback();
        const data =
          path === "/api/me"
            ? {
                ...shellUser,
                capabilities: [
                  CAPABILITIES.APPLICATIONS_MANAGE,
                  CAPABILITIES.APPLICATIONS_REVIEW,
                  CAPABILITIES.APPLICATIONS_DECIDE,
                  CAPABILITIES.APPLICATIONS_EDIT_RESPONSE,
                  CAPABILITIES.EXPORTS_RUN,
                ],
              }
            : path === "/api/applications/1"
              ? {
                  id: 1,
                  name: "Participant form",
                  template,
                  sections: [section],
                  grants_role_ids: [],
                  ask_shirt_size: false,
                  ask_food_intolerances: false,
                }
              : path === "/api/applications/1/responses"
                ? { responses: [response, { ...response, id: 11, name: "Next Applicant" }] }
                : path === "/api/public/food-intolerances"
                  ? { intolerances: [] }
                  : {};
        return route.fulfill({ json: data });
      });
      await page.goto("/applications/1?tab=review");
      const exportList = page.getByRole("button", { name: "Export", exact: true });
      await expect(exportList).toBeVisible();
      await expect(exportList).toContainText("Export");
      await expect(page.getByRole("button", { name: /^Avery Applicant/ })).toBeVisible();
      const scoreButton = page.getByRole("button", { name: "Select by score", exact: true });
      const exportBox = await exportList.boundingBox();
      const scoreBox = await scoreButton.boundingBox();
      expect(Math.abs(exportBox!.y - scoreBox!.y)).toBeLessThan(2);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: info.outputPath(`list-${width}-${theme}.png`),
        animations: "disabled",
        style: "nextjs-portal { visibility: hidden }",
      });
      await page.getByRole("button", { name: /^Avery Applicant/ }).click();
      const dialog = page.getByRole("dialog", { name: "Avery Applicant", exact: true });
      await expect(dialog).toBeVisible();
      const geometry = await dialog.evaluate((element) => {
        const header = element.querySelector('[data-slot="dialog-header"]')!;
        const buttons = [...header.querySelectorAll<HTMLButtonElement>("button")].filter(
          (button) => button.getBoundingClientRect().width > 0,
        );
        return {
          headerHeight: header.getBoundingClientRect().height,
          tops: buttons.map((button) => button.getBoundingClientRect().top),
          overflow: element.scrollWidth > element.clientWidth,
        };
      });
      expect(geometry.overflow).toBe(false);
      expect(geometry.headerHeight).toBeLessThan(130);
      expect(Math.max(...geometry.tops) - Math.min(...geometry.tops)).toBeLessThan(2);
      await page.screenshot({
        path: info.outputPath(`review-${width}-${theme}.png`),
        animations: "disabled",
        style: "nextjs-portal { visibility: hidden }",
      });
      if (width < 640) {
        await dialog.getByRole("button", { name: "More actions", exact: true }).click();
        await expect(
          page.getByRole("menuitem", { name: "Copy response link", exact: true }),
        ).toBeVisible();
        await page.screenshot({
          path: info.outputPath(`export-menu-${width}-${theme}.png`),
          animations: "disabled",
          style: "nextjs-portal { visibility: hidden }",
        });
      }
      const download = page.waitForEvent("download");
      await page
        .getByRole(width < 640 ? "menuitem" : "button", { name: "Export answers", exact: true })
        .click();
      expect((await download).suggestedFilename()).toBe("Avery-Applicant-answers.csv");
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "View reviews (3)", exact: true }).click();
      await expect(dialog.getByText("Review notes 2", { exact: true })).toBeVisible();
      await page.screenshot({
        path: info.outputPath(`reviews-${width}-${theme}.png`),
        animations: "disabled",
        style: "nextjs-portal { visibility: hidden }",
      });
      await dialog.getByRole("button", { name: "Back to application", exact: true }).click();
      const summary = dialog.getByText("3.7/5", { exact: false }).first();
      const before = await summary.boundingBox();
      await dialog.locator(":scope > .overflow-y-auto").evaluate((element) => {
        element.scrollTop = 300;
      });
      const after = await summary.boundingBox();
      expect(after!.y).toBeLessThan(before!.y - 100);
      await page.screenshot({
        path: info.outputPath(`review-scrolled-${width}-${theme}.png`),
        animations: "disabled",
        style: "nextjs-portal { visibility: hidden }",
      });
    });
  }
}
