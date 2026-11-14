import { expect, shellUser, test } from "./fixtures";

// H44, H63: shared profiles retain their origin and sample private photos.
test("company representative photo tint and return navigation", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.addInitScript(() => {
    localStorage.setItem("hackos-language", "en");
    localStorage.setItem("hackos.cookie-notice.dismissed", "true");
  });
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/me/public-profile") return route.fallback();
    if (path === "/api/public/challenges") return route.fulfill({ json: { items: [] } });
    if (path === "/api/me") return route.fulfill({ json: shellUser });
    if (path === "/api/logo" || path === "/api/logo-dark")
      return route.fulfill({
        contentType: "image/svg+xml",
        body: `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><text x="0" y="26" fill="${path.endsWith("-dark") ? "white" : "black"}" font-size="14">GPUL</text></svg>`,
      });
    if (path === "/api/users/42/photo")
      return route.fulfill({
        contentType: "image/svg+xml",
        headers: {
          "access-control-allow-origin": "http://localhost:3001",
          "access-control-allow-credentials": "true",
        },
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><path fill="#b87532" d="M0 0h32v32H0z"/></svg>',
      });
    if (path === "/api/enterprises/7/profile")
      return route.fulfill({
        json: {
          id: 7,
          name: "GPUL",
          logoUrl: null,
          website: null,
          description: null,
          representatives: [{ userId: 42, name: "Ana Pérez", avatarUrl: "/api/users/42/photo" }],
          challenges: [],
          activities: [],
        },
      });
    if (path === "/api/directory/42")
      return route.fulfill({
        json: {
          userId: 42,
          displayName: "Ana Pérez",
          photoUrl: "/api/users/42/photo",
          headline: "Software engineer",
          bio: null,
          socials: [],
          projects: [],
          challenges: [],
          enterprises: [
            {
              id: 7,
              name: "GPUL",
              logoUrl: "http://localhost:3000/api/logo",
              logoNegativeUrl: "http://localhost:3000/api/logo-dark",
            },
          ],
        },
      });
    return route.fulfill({ json: {} });
  });
  await page.goto("/companies/7");
  await page.getByRole("link", { name: "Ana Pérez" }).click();
  await expect(page).toHaveURL(/people\/42\?company=7/);
  const back = page.locator("[data-back-link]");
  await expect(back).toHaveText("GPUL");
  await expect
    .poll(() =>
      page
        .locator("[data-hero-bleed] > [aria-hidden]")
        .evaluate((el) => (el as HTMLElement).style.backgroundImage),
    )
    .toContain("#b87532");
  await page.screenshot({ path: info.outputPath("person-company.png"), fullPage: true });
  await back.click();
  await expect(page).toHaveURL(/companies\/7$/);
  await page.goto("/people/42");
  await expect(page.locator("[data-back-link]")).toHaveAttribute("href", "/people");
  await page.getByRole("link", { name: "GPUL", exact: true }).click();
  await expect(page).toHaveURL(/companies\/7$/);
  await expect(back).toHaveText("Ana Pérez");
  await expect(back).toHaveAttribute("href", "/people/42");
  await page.getByRole("link", { name: "Ana Pérez", exact: true }).click();
  await expect(back).toHaveText("GPUL");
  await back.click();
  await expect(page).toHaveURL(/companies\/7$/);
  await expect(back).toHaveText("Ana Pérez");
  await page.screenshot({ path: info.outputPath("company-from-person.png"), fullPage: true });
  await back.click();
  await expect(page).toHaveURL(/people\/42$/);
  await expect(back).toHaveAttribute("href", "/people");
  await page.route("**/api/helpdesk/helpers/42", (route) =>
    route.fulfill({
      json: {
        profile: {
          userId: 42,
          displayName: "Ana Pérez",
          photoUrl: "/api/users/42/photo",
          socials: [],
          projects: [],
          challenges: [],
        },
        affiliation: "GPUL",
        affiliationLogoUrl: "http://localhost:3000/api/logo",
        affiliationLogoNegativeUrl: "http://localhost:3000/api/logo-dark",
        visibleRoleName: "Organizer",
        present: true,
        topics: [],
        challenges: [],
        availability: [],
      },
    }),
  );
  await page.goto("/help-desk/helpers/42");
  const role = page.getByText("Organizer", { exact: true });
  await expect(role).toBeVisible();
  const backBox = await page.locator("[data-back-link]").boundingBox();
  const roleBox = await role.boundingBox();
  expect(Math.abs((backBox?.y ?? 0) - (roleBox?.y ?? 0))).toBeLessThan(10);
  expect(roleBox?.x).toBeGreaterThan((backBox?.x ?? 0) + (backBox?.width ?? 0));
  await page.screenshot({ path: info.outputPath("helper-role.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath("helper-role-narrow.png"), fullPage: true });
  await page.evaluate(() => localStorage.setItem("theme", "dark"));
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(role).toBeVisible();
  await expect(page.locator('img[src="http://localhost:3000/api/logo-dark"]')).toBeVisible();
  await expect(page.locator('img[src="http://localhost:3000/api/logo"]')).toBeHidden();
  await page.screenshot({ path: info.outputPath("helper-role-narrow-dark.png"), fullPage: true });
  expect(
    errors.filter((message) => /useInsertionEffect|Maximum update depth/.test(message)),
  ).toEqual([]);
});
