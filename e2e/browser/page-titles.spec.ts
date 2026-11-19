import { expect, test } from "./fixtures";

test("tab text follows the current authentication screen and back navigation", async ({ page }) => {
  for (const path of ["/login", "/signup", "/forgot-password"]) {
    await page.goto(path);
    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toBeVisible();
    await expect(page).toHaveTitle(`${await heading.innerText()} | hackOS`);
    await expect(page.locator("title")).toHaveCount(1);
  }
  await page.goBack();
  await expect(page).toHaveURL(/\/signup/);
  await expect(page).toHaveTitle(
    `${await page.getByRole("heading", { level: 1 }).innerText()} | hackOS`,
  );
});

test("updates tab text during client-side navigation", async ({ page }) => {
  await page.goto("/login");
  const original = await page.getByRole("heading", { level: 1 }).innerText();
  await expect(page).toHaveTitle(`${original} | hackOS`);
  // H49/H55: reproduce metadata resolving after the client screen has mounted.
  await page.evaluate(() => {
    document.title = "hackOS — Hackathon management";
  });
  await expect(page).toHaveTitle(`${original} | hackOS`);
  await page.locator('a[href^="/signup"]').click();
  await expect(page).toHaveURL(/\/signup/);
  await expect(page).toHaveTitle(
    `${await page.getByRole("heading", { level: 1 }).innerText()} | hackOS`,
  );
  await page.goBack();
  await expect(page).toHaveURL(/\/login/);
  await expect(page).toHaveTitle(`${original} | hackOS`);
  await expect(page.locator("title")).toHaveCount(1);
});
