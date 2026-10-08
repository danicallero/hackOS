import { expect, test } from "./fixtures";

const labels = { es: "Dieta vegana", gl: "Dieta vegana (galego)", en: "Vegan diet" };

for (const initial of ["es", "gl", "en"] as const) {
  test(`invitation language follows both selectors from ${initial} (H7/H10)`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript((language) => {
      localStorage.setItem("hackos-language", language);
      // H7/H10: seed unrelated notice state before hydration, so a delayed
      // cookie banner cannot cover the form after an early visibility check.
      localStorage.setItem("hackos.cookie-notice.dismissed", "true");
    }, initial);
    await page.route("**/api/me", (route) => route.fulfill({ status: 401, json: {} }));
    await page.route("**/api/public/event", (route) =>
      route.fulfill({ json: { shirtSizes: ["M"] } }),
    );
    await page.route("**/api/invites/lookup?*", (route) =>
      route.fulfill({
        json: {
          email: "invite@example.test",
          kind: "staff",
          reusable: false,
          expired: false,
          requireShirtSize: false,
          requireDietary: true,
        },
      }),
    );
    await page.route("**/api/public/food-intolerances", (route) =>
      route.fulfill({ json: { intolerances: [{ id: 7, label: labels }] } }),
    );
    let submitted: Record<string, unknown> | undefined;
    await page.route("**/api/invites/accept", async (route) => {
      submitted = route.request().postDataJSON();
      await route.fulfill({ json: {} });
    });
    await page.goto("/claim-account?token=language-test");
    const form = page.locator("form");
    await expect(form.getByRole("combobox").first()).toHaveText(
      { es: "Castellano", gl: "Galego", en: "English" }[initial],
    );
    await form.getByRole("combobox").last().click();
    await page.getByRole("option", { name: labels[initial], exact: true }).click();
    await page.keyboard.press("Escape");
    await form.locator('input[autocomplete="given-name"]').fill("Test");
    await form.locator('input[autocomplete="family-name"]').fill("Invite");
    await form.locator('input[autocomplete="new-password"]').nth(0).fill("Secret123!");
    await form.locator('input[autocomplete="new-password"]').nth(1).fill("Secret123!");

    await page.locator("header").getByRole("combobox").click();
    await page.getByRole("option", { name: "English", exact: true }).click();
    await expect(form.getByRole("combobox").first()).toHaveText("English");
    await expect(form.getByText(labels.en, { exact: true })).toBeVisible();
    await expect(
      form.getByRole("button", { name: "Create an account", exact: true }),
    ).toBeVisible();

    await form.getByRole("combobox").first().click();
    await page.getByRole("option", { name: "Galego", exact: true }).click();
    await expect(page.locator("header").getByRole("combobox")).toHaveText("GL");
    await expect(form.getByText(labels.gl, { exact: true })).toBeVisible();
    await expect(form.locator('input[autocomplete="given-name"]')).toHaveValue("Test");
    await page.screenshot({
      path: testInfo.outputPath("invitation-gl.png"),
      fullPage: true,
    });
    const savedLanguage = initial === "gl" ? "es" : "gl";
    if (savedLanguage === "es") {
      await page.locator("header").getByRole("combobox").click();
      await page.getByRole("option", { name: "Castellano", exact: true }).click();
      await expect(form.getByRole("combobox").first()).toHaveText("Castellano");
      await expect(form.getByText(labels.es, { exact: true })).toBeVisible();
    }
    await form.locator('button[type="submit"]').click();
    await expect
      .poll(() => submitted)
      .toMatchObject({
        language: savedLanguage,
        foodIntolerances: [7],
        name: "Test",
        surname: "Invite",
      });
  });
}
