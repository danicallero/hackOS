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
      const applicantName =
        width === 320 ? "Avery Applicant with a longer surname" : "Avery Applicant";
      const response = {
        id: 10,
        user_id: 22,
        name: applicantName,
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
      const dialog = page.getByRole("dialog", { name: applicantName, exact: true });
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
      if (width < 640) {
        const identity = dialog.locator('[data-slot="dialog-title"] .heading-label');
        const identityGeometry = await identity.evaluate((element) => ({
          height: element.getBoundingClientRect().height,
          lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight),
          whiteSpace: getComputedStyle(element).whiteSpace,
          overflow: getComputedStyle(element).textOverflow,
          clipped: element.scrollWidth > element.clientWidth,
        }));
        expect(identityGeometry.whiteSpace).toBe("nowrap");
        expect(identityGeometry.overflow).toBe("ellipsis");
        expect(identityGeometry.height).toBeLessThanOrEqual(identityGeometry.lineHeight + 1);
        if (width === 320) {
          expect(identityGeometry.clipped).toBe(true);
          const nameBox = await identity.boundingBox();
          const dialogBox = await dialog.boundingBox();
          expect(nameBox!.width).toBeGreaterThan(dialogBox!.width - 90);
          const closeBox = await dialog
            .getByRole("button", { name: "Close", exact: true })
            .boundingBox();
          expect(nameBox!.y).toBeGreaterThanOrEqual(closeBox!.y + closeBox!.height);
        }
      }
      expect(geometry.headerHeight).toBeLessThan(width < 640 ? 200 : 130);
      if (width >= 640)
        expect(Math.max(...geometry.tops) - Math.min(...geometry.tops)).toBeLessThan(2);
      await page.screenshot({
        path: info.outputPath(`review-${width}-${theme}.png`),
        animations: "disabled",
        style: "nextjs-portal { visibility: hidden }",
      });
      if (width < 640) {
        const header = dialog.locator('[data-slot="dialog-header"]');
        const state = header.getByText("In review", { exact: true });
        await expect(state).toBeVisible();
        await expect(header.getByText("Reviewed by you", { exact: true })).toHaveCount(0);
        const reviewed = dialog.getByText("Reviewed by you", { exact: true });
        await expect(reviewed).toHaveClass("sr-only sm:not-sr-only");
        const score = dialog.getByText("3.7/5 avg", { exact: true });
        const reviewButton = dialog.getByRole("button", { name: "View reviews (3)", exact: true });
        const scoreBox = await score.boundingBox();
        const reviewedBox = await reviewed.locator("..").boundingBox();
        const reviewsBox = await reviewButton.boundingBox();
        expect(reviewedBox!.x).toBeGreaterThan(scoreBox!.x + scoreBox!.width);
        expect(reviewsBox!.x).toBeGreaterThan(reviewedBox!.x + reviewedBox!.width);
        expect(
          Math.abs(scoreBox!.y + scoreBox!.height / 2 - reviewsBox!.y - reviewsBox!.height / 2),
        ).toBeLessThan(3);
        const nav = await header
          .getByRole("button", { name: "Next candidate", exact: true })
          .boundingBox();
        const close = await dialog
          .getByRole("button", { name: "Close", exact: true })
          .boundingBox();
        expect(Math.abs(nav!.y - close!.y)).toBeLessThan(2);
        const decision = await header
          .getByRole("button", { name: "Decision actions", exact: true })
          .boundingBox();
        const stateBox = await state.boundingBox();
        expect(stateBox!.x).toBeGreaterThan(decision!.x + decision!.width);
        expect(
          Math.abs(stateBox!.y + stateBox!.height / 2 - decision!.y - decision!.height / 2),
        ).toBeLessThan(3);
        if (
          !(await dialog.getByRole("button", { name: "Export answers", exact: true }).isVisible())
        ) {
          await dialog.getByRole("button", { name: "More actions", exact: true }).click();
        }
        await page.screenshot({
          path: info.outputPath(`export-menu-${width}-${theme}.png`),
          animations: "disabled",
          style: "nextjs-portal { visibility: hidden }",
        });
      }
      const download = page.waitForEvent("download");
      const directExport = dialog.getByRole("button", { name: "Export answers", exact: true });
      if (await directExport.isVisible()) await directExport.click();
      else await page.getByRole("menuitem", { name: "Export answers", exact: true }).click();
      expect((await download).suggestedFilename()).toBe(
        `${applicantName.replaceAll(" ", "-")}-answers.csv`,
      );
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
      if (width === 393 && theme === "dark") {
        await page.setViewportSize({ width: 320, height: 844 });
        await expect
          .poll(() => dialog.evaluate((element) => element.scrollWidth <= element.clientWidth))
          .toBe(true);
        await page.setViewportSize({ width: 393, height: 844 });
        await expect(
          dialog.getByRole("button", { name: "Export answers", exact: true }),
        ).toBeVisible();
        await expect(dialog.getByRole("button", { name: "More actions", exact: true })).toHaveCount(
          0,
        );
        await dialog.getByRole("button", { name: "Decision actions", exact: true }).click();
        await expect(page.getByRole("menuitem", { name: "Accept", exact: true })).toBeVisible();
        for (const access of ["reviewer", "exporter", "decider"] as const) {
          const capabilities =
            access === "decider"
              ? [CAPABILITIES.APPLICATIONS_DECIDE]
              : [
                  CAPABILITIES.APPLICATIONS_REVIEW,
                  ...(access === "exporter" ? [CAPABILITIES.EXPORTS_RUN] : []),
                ];
          await page.route("**/api/me", (route) =>
            route.fulfill({ json: { ...shellUser, capabilities } }),
          );
          await page.reload();
          const limited = page.getByRole("dialog", { name: applicantName, exact: true });
          await expect(
            limited.getByRole("button", { name: "Copy response link", exact: true }),
          ).toBeVisible();
          await expect(
            limited.getByRole("button", { name: "More actions", exact: true }),
          ).toHaveCount(0);
          await expect(
            limited.getByRole("button", { name: "Edit answers", exact: true }),
          ).toHaveCount(0);
          if (access === "exporter")
            await expect(
              limited.getByRole("button", { name: "Export answers", exact: true }),
            ).toBeVisible();
          else
            await expect(
              limited.getByRole("button", { name: "Export answers", exact: true }),
            ).toHaveCount(0);
          if (access === "decider")
            await expect(
              limited.getByRole("button", { name: "Decision actions", exact: true }),
            ).toBeVisible();
          else
            await expect(
              limited.getByRole("button", { name: "Decision actions", exact: true }),
            ).toHaveCount(0);
          await page.screenshot({
            path: info.outputPath(`review-permissions-${access}.png`),
            animations: "disabled",
            style: "nextjs-portal { visibility: hidden }",
          });
        }
      }
    });
  }
}
