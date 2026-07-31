import { test as base, expect, type Locator, type Page } from "@playwright/test";
import { UI_TEST_IDS } from "../../packages/shared/src/ui-test-ids";

/** Page object for the shared H1-H5/H4 sign-in entry point. */
export class SignInPage {
  readonly email: Locator;
  readonly password: Locator;
  readonly submit: Locator;
  readonly error: Locator;

  constructor(public readonly page: Page) {
    this.email = page.getByTestId(UI_TEST_IDS.auth.email);
    this.password = page.getByTestId(UI_TEST_IDS.auth.password);
    this.submit = page.getByTestId(UI_TEST_IDS.auth.submit);
    this.error = page.getByTestId(UI_TEST_IDS.auth.error);
  }

  async open() {
    // Keep the smoke flow deterministic: the real app treats an API network
    // failure as unauthenticated, so return the same boundary without needing
    // Postgres or a seeded session (H4).
    await this.page.route("**/api/me", (route) =>
      route.fulfill({
        body: JSON.stringify({ error: { code: "unauthenticated", message: "Not signed in" } }),
        contentType: "application/json",
        status: 401,
      }),
    );
    await this.page.goto("/login");
    await expect(this.email).toBeVisible();
    const cookieNotice = this.page.locator('aside[aria-labelledby="cookie-notice-title"]');
    if (await cookieNotice.isVisible()) await cookieNotice.locator("button").click();
  }

  async fillCredentials(email: string, password: string) {
    await this.email.fill(email);
    await this.password.fill(password);
  }

  async submitCredentials() {
    await this.submit.click();
  }
}

type UiFixtures = {
  signIn: SignInPage;
};

export const test = base.extend<UiFixtures>({
  signIn: async ({ page }, use) => {
    await use(new SignInPage(page));
  },
});

export { expect };
