import { expect, shellUser, test } from "./fixtures";

const emptyProfile = {
  directoryVisible: false,
  showSurname: false,
  showPhoto: false,
  showProject: true,
  headline: null,
  locationNote: null,
  bio: null,
  socials: [],
  shareCv: false,
  cv: null,
  consentedAt: null,
  onboardingCompletedAt: null,
  preview: {
    userId: 1,
    displayName: "Shell O.",
    photoUrl: null,
    headline: null,
    bio: null,
    locationNote: null,
    socials: [],
    cvUrl: null,
    projects: [],
    challenges: [],
  },
};

test("profile step saves an explicit hidden choice after confirmation (H7/H15)", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem("hackos-language", "en");
    localStorage.setItem("hackos.cookie-notice.dismissed", "true");
  });
  await page.route("**/api/me", (route) =>
    route.fulfill({ json: { ...shellUser, pendingProfileTasks: [] } }),
  );
  await page.route("**/api/applications/confirm", (route) =>
    route.fulfill({
      json: {
        status: "confirmed",
        already_confirmed: false,
        ticket_token: null,
        user_id: 1,
        masked_email: "s***@example.com",
        wallet_token: "scoped",
        wallet_token_expires_at: "2030-01-01",
      },
    }),
  );
  let saved: Record<string, unknown> | undefined;
  await page.route("**/api/me/public-profile", async (route) => {
    if (route.request().method() === "PUT") {
      saved = route.request().postDataJSON();
      return route.fulfill({
        json: { ...emptyProfile, ...saved, onboardingCompletedAt: new Date().toISOString() },
      });
    }
    return route.fulfill({ json: emptyProfile });
  });
  await page.goto("/applications/confirm?token=profile-test");
  await expect(page.getByRole("heading", { name: "Build your networking profile" })).toBeVisible();
  await expect(page.getByText(/^(?:[12] of 2|[12]\/2)$/)).toHaveCount(0);
  await expect(page.getByRole("switch", { name: "Share my profile", exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("profile-hidden.png"), fullPage: true });
  await page.getByRole("button", { name: "Keep my profile hidden", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Your place is confirmed", exact: true }),
  ).toBeVisible();
  expect(saved).toMatchObject({ directoryVisible: false, completeOnboarding: true });
});

test("profile sharing is explicit and lets attendees build their profile (H7)", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem("hackos-language", "en");
    localStorage.setItem("hackos.cookie-notice.dismissed", "true");
  });
  await page.route("**/api/me", (route) =>
    route.fulfill({ json: { ...shellUser, pendingProfileTasks: [] } }),
  );
  let profile = { ...emptyProfile };
  let saved: Record<string, unknown> | undefined;
  await page.route("**/api/me/public-profile", async (route) => {
    if (route.request().method() === "PUT") {
      saved = route.request().postDataJSON();
      profile = {
        ...profile,
        ...saved,
        onboardingCompletedAt: new Date().toISOString(),
      } as typeof profile;
    }
    await route.fulfill({ json: profile });
  });
  await page.route("**/api/me/notifications**", (route) =>
    route.fulfill({ json: { items: [], total: 0 } }),
  );
  await page.goto("/inbox");
  await page.getByRole("button", { name: "Create profile", exact: true }).click();
  expect(saved).toBeUndefined();
  await expect(page.getByRole("switch", { name: "Share my profile", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Upload CV", exact: true })).toHaveCount(0);
  await expect(page.locator('input[type="file"][accept="application/pdf"]')).toHaveCount(0);
  await page.getByLabel("Headline", { exact: true }).fill("Building useful things");
  await page
    .getByLabel("Bio", { exact: true })
    .fill("Looking for people to build with during the event.");
  await page.screenshot({ path: testInfo.outputPath("profile-editor.png"), fullPage: true });
  await page.getByRole("button", { name: "Toggle theme", exact: true }).click();
  await page.getByRole("menuitem", { name: "Dark", exact: true }).click();
  await expect(page.getByLabel("Headline", { exact: true })).toHaveCSS(
    "color",
    "rgb(250, 250, 250)",
  );
  await expect(
    page.getByRole("button", { name: "Save profile and continue", exact: true }),
  ).toHaveCSS("background-color", "rgb(163, 213, 255)");
  await page.screenshot({ path: testInfo.outputPath("profile-editor-dark.png"), fullPage: true });
  await page.getByRole("button", { name: "Save profile and continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Build your networking profile" })).toHaveCount(0);
  expect(saved).toMatchObject({
    directoryVisible: true,
    completeOnboarding: true,
    headline: "Building useful things",
  });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Inbox", exact: true })).toBeVisible();
});

test("reminder survives reload and returns after the next login (H4/H7)", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("hackos-language", "en");
    localStorage.setItem("hackos.cookie-notice.dismissed", "true");
  });
  let signedIn = true;
  let writes = 0;
  await page.route("**/api/me", (route) =>
    route.fulfill(
      signedIn ? { json: { ...shellUser, pendingProfileTasks: [] } } : { status: 401, json: {} },
    ),
  );
  await page.route("**/api/me/public-profile", (route) => {
    if (route.request().method() === "PUT") writes += 1;
    return route.fulfill({ json: emptyProfile });
  });
  await page.route("**/api/me/notifications**", (route) =>
    route.fulfill({ json: { items: [], total: 0 } }),
  );
  await page.route("**/api/auth/sign-in/email", (route) => {
    signedIn = true;
    return route.fulfill({ json: { user: { id: "1" }, token: "test" } });
  });
  await page.goto("/inbox");
  await expect(
    page.getByRole("button", { name: "Remind me on next login", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("onboarding-reminder-label.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Remind me on next login", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Inbox", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Inbox", exact: true })).toBeVisible();
  expect(writes).toBe(0);
  await expect(page.getByRole("switch", { name: "Share my profile", exact: true })).toHaveCount(0);
  signedIn = false;
  await page.goto("/login?next=/inbox");
  await page.getByLabel("Email", { exact: true }).fill("operator@example.com");
  await page.getByLabel("Password", { exact: true }).fill("Secret123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Build your networking profile" })).toBeVisible();
});

test("account invitation continues straight into profile creation (H10)", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("hackos-language", "en");
    localStorage.setItem("hackos.cookie-notice.dismissed", "true");
  });
  let signedIn = false;
  await page.route("**/api/me", (route) =>
    route.fulfill(
      signedIn ? { json: { ...shellUser, pendingProfileTasks: [] } } : { status: 401, json: {} },
    ),
  );
  await page.route("**/api/me/public-profile", (route) => route.fulfill({ json: emptyProfile }));
  await page.route("**/api/public/event", (route) =>
    route.fulfill({ json: { shirtSizes: ["M"] } }),
  );
  await page.route("**/api/public/food-intolerances", (route) =>
    route.fulfill({ json: { intolerances: [] } }),
  );
  await page.route("**/api/invites/lookup?*", (route) =>
    route.fulfill({
      json: {
        email: "operator@example.com",
        kind: "staff",
        reusable: false,
        expired: false,
        requireShirtSize: false,
        requireDietary: false,
      },
    }),
  );
  await page.route("**/api/invites/accept", (route) =>
    route.fulfill({ json: { userId: 1, email: "operator@example.com", kind: "staff" } }),
  );
  await page.route("**/api/auth/sign-in/email", (route) => {
    expect(route.request().postDataJSON()).toMatchObject({
      email: "operator@example.com",
      password: "Secret123!",
    });
    signedIn = true;
    return route.fulfill({ json: { user: { id: "1" }, token: "test" } });
  });
  await page.goto("/claim-account?token=account-profile-test");
  await page.locator('input[autocomplete="given-name"]').fill("Shell");
  await page.locator('input[autocomplete="family-name"]').fill("Operator");
  await page.locator('input[autocomplete="new-password"]').nth(0).fill("Secret123!");
  await page.locator('input[autocomplete="new-password"]').nth(1).fill("Secret123!");
  await page.getByRole("button", { name: "Create an account", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Build your networking profile" })).toBeVisible();
});

test("application CV is inherited read-only during onboarding (H7/H10/H15)", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem("hackos-language", "en");
    localStorage.setItem("hackos.cookie-notice.dismissed", "true");
  });
  await page.route("**/api/me", (route) =>
    route.fulfill({ json: { ...shellUser, pendingProfileTasks: [] } }),
  );
  await page.route("**/api/me/public-profile", (route) =>
    route.fulfill({
      json: {
        ...emptyProfile,
        cv: {
          filename: "application-cv.pdf",
          uploadedAt: "2026-10-10T10:00:00.000Z",
          source: "application",
        },
      },
    }),
  );
  await page.goto("/inbox");
  await page.getByRole("button", { name: "Create profile", exact: true }).click();
  await expect(page.getByRole("button", { name: "application-cv.pdf", exact: true })).toBeVisible();
  await expect(
    page.getByText("From your application. It can't be changed here.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("switch", { name: "Share CV", exact: true })).toBeVisible();
  for (const name of ["Upload CV", "Replace CV", "Remove CV"]) {
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
  }
  await expect(page.locator('input[type="file"][accept="application/pdf"]')).toHaveCount(0);
  await page.mouse.move(0, 0);
  await expect(
    page.getByRole("button", { name: "Save profile and continue", exact: true }),
  ).toHaveCSS("background-color", "rgb(3, 8, 70)");
  await page.screenshot({
    path: testInfo.outputPath("application-cv-readonly.png"),
    fullPage: true,
  });
});
