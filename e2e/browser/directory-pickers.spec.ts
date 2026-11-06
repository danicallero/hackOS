import { CAPABILITIES } from "../../packages/shared/src/capabilities";
import { expect, shellUser, test } from "./fixtures";

const longName =
  "Ingeniería de Sistemas de Telecomunicación y Tecnologías de la Información ".repeat(2);

// H12: directory selections stay usable inside confirmation and response editors.
for (const directory of ["degrees", "universities"] as const) {
  for (const width of [390, 1440]) {
    test(`${directory} normalization at ${width}px`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.addInitScript(() => {
        localStorage.setItem("hackos-language", "en");
        localStorage.setItem("hackos.cookie-notice.dismissed", "true");
      });
      let normalized: unknown;
      await page.route("**/api/**", (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path === "/api/me/public-profile") return route.fallback();
        if (path === "/api/me")
          return route.fulfill({
            json: { ...shellUser, capabilities: [CAPABILITIES.INTOLERANCES_MANAGE] },
          });
        if (path === `/api/${directory}/1/normalize`) {
          normalized = route.request().postDataJSON();
          return route.fulfill({ json: {} });
        }
        if (path === `/api/public/${directory}`)
          return route.fulfill({
            json: {
              [directory]: [
                { id: 1, name: `Original ${longName}` },
                { id: 2, name: longName },
              ],
            },
          });
        return route.fulfill({ json: {} });
      });
      await page.goto(`/settings/libraries?tab=${directory}`);
      await page
        .getByRole("row")
        .filter({ hasText: `Original ${longName}` })
        .getByRole("button")
        .click();
      await page.getByRole("menuitem", { name: /Merge/ }).click();
      const dialog = page.getByRole("alertdialog");
      const picker = dialog.getByRole("combobox").first();
      await picker.click();
      await page.getByRole("combobox", { name: /Search/ }).fill("ingenieria");
      const option = page.getByRole("option", { name: longName, exact: true });
      await expect(option).toBeVisible();
      await page.screenshot({
        path: info.outputPath(`${directory}-${width}-accent-search.png`),
        style: "nextjs-portal { visibility: hidden }",
      });
      await option.scrollIntoViewIfNeeded();
      await expect(option).toBeInViewport();
      await option.click();
      await expect(picker).toContainText(longName);
      expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
      const confirm = dialog.getByRole("button", { name: /Merge/ });
      await expect(confirm).toBeInViewport();
      await page.screenshot({
        path: info.outputPath(`${directory}-${width}-selected.png`),
        style: "nextjs-portal { visibility: hidden }",
      });
      await picker.click();
      await expect(option).toBeVisible();
      await option.evaluate((node) => node.scrollIntoView({ block: "nearest" }));
      // The center must be painted by the option, rather than clipped by the modal.
      expect(
        await option.evaluate((node) => {
          const box = node.getBoundingClientRect();
          return node.contains(
            document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2),
          );
        }),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath(`${directory}-${width}.png`),
        style: "nextjs-portal { visibility: hidden }",
      });
      await page.keyboard.press("Escape");
      await expect(picker).toBeFocused();
      await expect(dialog).toBeVisible();
      await confirm.click();
      await expect.poll(() => normalized).toEqual({ targetId: 2 });
      await expect(dialog).toBeHidden();
    });
  }
}

test("degree selection in an application response editor", async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    localStorage.setItem("hackos-language", "en");
    localStorage.setItem("hackos.cookie-notice.dismissed", "true");
  });
  const template = [
    { key: "degree", kind: "degree", label: { en: "Degree", es: "Grado", gl: "Grao" } },
  ];
  const response = {
    id: 10,
    user_id: 22,
    name: "Avery Applicant",
    email: "avery@example.test",
    status: "review",
    responses: { degree: 1 },
    shirt_size: null,
    food_intolerances: [],
    food_intolerance_notes: null,
    staff_notes: null,
    submitted_at: "2026-11-03T10:00:00Z",
    decision_sent_at: null,
    confirmation_expires_at: null,
    confirmed_at: null,
    declined_at: null,
    avg_score: null,
    review_count: 0,
    reviews: [],
  };
  let saved: unknown;
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/me/public-profile") return route.fallback();
    if (path === "/api/me")
      return route.fulfill({
        json: {
          ...shellUser,
          capabilities: [
            CAPABILITIES.APPLICATIONS_MANAGE,
            CAPABILITIES.APPLICATIONS_REVIEW,
            CAPABILITIES.APPLICATIONS_EDIT_RESPONSE,
          ],
        },
      });
    if (path === "/api/public/degrees")
      return route.fulfill({
        json: {
          degrees: [
            { id: 1, name: "Original" },
            { id: 2, name: longName },
          ],
        },
      });
    if (path === "/api/applications/1")
      return route.fulfill({
        json: {
          id: 1,
          name: "Participant form",
          template,
          sections: [],
          grants_role_ids: [],
          ask_shirt_size: false,
          ask_food_intolerances: false,
        },
      });
    if (path === "/api/applications/1/responses")
      return route.fulfill({ json: { responses: [response] } });
    if (route.request().method() === "PUT") {
      saved = route.request().postDataJSON();
      return route.fulfill({ json: response });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto("/applications/1?tab=review&response=10");
  const dialog = page.getByRole("dialog", { name: "Avery Applicant", exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Edit answers", exact: true }).click();
  const picker = dialog.getByRole("combobox", { name: "Degree", exact: true });
  await picker.click();
  await page.getByRole("option", { name: longName, exact: true }).click({ timeout: 5000 });
  await expect(picker).toContainText(longName);
  await page.screenshot({
    path: info.outputPath("application-degree.png"),
    style: "nextjs-portal { visibility: hidden }",
  });
  await dialog.getByRole("button", { name: "Save answers", exact: true }).first().click();
  await expect.poll(() => saved).toMatchObject({ responses: { degree: 2 } });
});
