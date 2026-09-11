import { expect, shellUser, test } from "./fixtures";

test("keeps mobile shell notifications and page heading visible together", async ({ page }) => {
  test.skip(test.info().project.name !== "mobile-chromium", "Responsive shell coverage");

  await page.route("**/api/me", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify(shellUser) }),
  );
  await page.route("**/api/me/notifications**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ items: [], total: 1 }),
    }),
  );

  await page.goto("/inbox");

  const trigger = page.getByRole("button", { name: /toggle sidebar/i });
  const heading = page.getByRole("heading", { level: 1 });
  await expect(trigger).toBeVisible();
  await expect(trigger.locator('[data-sidebar="unread-indicator"]')).toBeVisible();
  await expect(heading).toBeVisible();

  const triggerBox = await trigger.boundingBox();
  const headingBox = await heading.boundingBox();
  expect(triggerBox).not.toBeNull();
  expect(headingBox).not.toBeNull();
  expect(headingBox?.x).toBeGreaterThan((triggerBox?.x ?? 0) + (triggerBox?.width ?? 0));
  expect(Math.abs((headingBox?.y ?? 0) - (triggerBox?.y ?? 0))).toBeLessThanOrEqual(2);
});
