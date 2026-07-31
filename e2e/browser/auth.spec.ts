import { expect, test } from "./fixtures";

test.describe("sign-in UI contract", () => {
  test("renders labelled controls on every browser project", async ({ signIn }) => {
    await signIn.open();

    await expect(signIn.email).toHaveAttribute("type", "email");
    await expect(signIn.email).toHaveAttribute("autocomplete", "email");
    await expect(signIn.password).toHaveAttribute("type", "password");
    await expect(signIn.password).toHaveAttribute("autocomplete", "current-password");
    await expect(signIn.submit).toBeEnabled();
  });

  test("keeps incomplete credentials in the form", async ({ signIn }) => {
    await signIn.open();
    await signIn.fillCredentials("person@example.com", "");
    await signIn.submitCredentials();

    await expect(signIn.password).toHaveAttribute("aria-invalid", "true");
    await expect(signIn.page.locator('[data-slot="form-message"]').first()).toBeVisible();
    await expect(signIn.error).toHaveCount(0);
  });
});
