import { CAPABILITIES } from "../../packages/shared/src/capabilities";
import { ERROR_REASONS } from "../../packages/shared/src/error-reasons";
import { expect, shellUser, test } from "./fixtures";

const messages = {
  en: "This degree is used in applications. Merge it into another degree before deleting it.",
  es: "Este grado se usa en solicitudes. Consolídalo en otro grado antes de eliminarlo.",
  gl: "Este grao úsase en solicitudes. Consolídao noutro grao antes de eliminalo.",
};

// H12/H54: deleting a shared degree explains consolidation and retains the record.
for (const language of ["en", "es", "gl"] as const) {
  for (const width of [390, 1440]) {
    test(`used degree deletion in ${language} at ${width}px`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript((locale) => {
        localStorage.setItem("hackos-language", locale);
        localStorage.setItem("hackos.cookie-notice.dismissed", "true");
      }, language);
      await page.route("**/api/**", (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path === "/api/me/public-profile") return route.fallback();
        if (path === "/api/me") {
          return route.fulfill({
            json: { ...shellUser, language, capabilities: [CAPABILITIES.INTOLERANCES_MANAGE] },
          });
        }
        if (path === "/api/public/degrees") {
          return route.fulfill({ json: { degrees: [{ id: 16, name: "Computer Engineering" }] } });
        }
        if (path === "/api/degrees/16" && route.request().method() === "DELETE") {
          return route.fulfill({
            status: 409,
            json: {
              error: {
                code: "conflict",
                message: "Server-only message",
                details: { code: ERROR_REASONS.DEGREE_IN_USE, id: 16 },
              },
            },
          });
        }
        return route.fulfill({ json: {} });
      });
      await page.goto("/settings/libraries?tab=degrees");
      const row = page.locator("tr", { hasText: "Computer Engineering" });
      await row.getByRole("button").click();
      await page.getByRole("menuitem", { name: /^(Delete|Eliminar)$/ }).click();
      const dialog = page.getByRole("alertdialog");
      await dialog.getByRole("button", { name: /^(Delete|Eliminar)$/ }).click();
      await expect(page.getByText(messages[language], { exact: true })).toBeVisible();
      await expect(dialog).toBeVisible();
      await expect(row).toContainText("Computer Engineering");
      await page.waitForTimeout(800);
      await page.screenshot({
        path: info.outputPath(`degree-in-use-${language}-${width}.png`),
        style: "nextjs-portal { visibility: hidden }",
      });
    });
  }
}
