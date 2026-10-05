import { expect, shellUser, test } from "./fixtures";

// H12/H36: shared web page compositions and their synthetic playground.
test.beforeEach(async ({ page }) => {
  await page.route("**/api/me", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify(shellUser) }),
  );
  await page.goto("/design-system");
  const cookies = page.locator('aside[aria-labelledby="cookie-notice-title"]');
  if (await cookies.isVisible()) await cookies.locator("button").first().click();
  await expect(page.getByRole("heading", { name: "Page patterns" })).toBeVisible();
});

test("list controls filter data and category tabs fit the viewport", async ({ page }) => {
  await page.getByRole("tabpanel", { name: "Dense list" }).getByRole("searchbox").fill("Grace");
  await expect(page.getByRole("tabpanel", { name: "Dense list" }).getByRole("row")).toHaveCount(7);
  await expect(page.getByRole("tabpanel", { name: "Dense list" })).not.toContainText(
    "Ada Lovelace",
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: `artifacts/surfaces/list-${test.info().project.name}.png`,
    fullPage: true,
    style: "nextjs-portal { visibility: hidden }",
  });
});

test("long editing shows dirty, loading, saved and persistent failed-save feedback", async ({
  page,
}) => {
  await page.getByRole("tab", { name: "Settings and editing" }).click();
  const panel = page.getByRole("tabpanel", { name: "Settings and editing" });
  await panel.getByLabel("Name", { exact: true }).fill("Updated preview");
  const actions = panel.locator(".form-action-footer");
  await expect(actions.getByRole("status")).toContainText("Unsaved changes");
  const save = actions.getByRole("button", { name: "Save changes", exact: true });
  await save.click();
  await expect(save).toHaveAttribute("aria-busy", "true");
  await expect(actions.getByRole("status")).toContainText("Saved");
  await panel.getByLabel("Simulate a save error").check();
  await save.click();
  await expect(panel.getByRole("alert")).toContainText("Your changes are still here");
  await expect(panel.getByLabel("Name", { exact: true })).toHaveValue("Updated preview");
  await expect(actions.getByRole("status")).toContainText("Save error");
  await page.screenshot({
    path: `artifacts/surfaces/save-error-${test.info().project.name}.png`,
    style: "nextjs-portal { visibility: hidden }",
  });
});

test("side editor keeps actions visible while its body scrolls and protects dirty input", async ({
  page,
}) => {
  const trigger = page.getByRole("button", { name: "Open record editor", exact: true }).first();
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Project name", { exact: true }).fill("Unsaved panel");
  page.once("dialog", (confirm) => confirm.dismiss());
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  const viewport = page.viewportSize()!;
  await page.setViewportSize({ width: viewport.width, height: 550 });
  await page.waitForTimeout(350);
  const geometry = await dialog.evaluate((element) => {
    const footer = element.querySelector('[data-slot="sheet-footer"]')!;
    const body = footer.previousElementSibling!;
    body.scrollTop = body.scrollHeight;
    return {
      width: element.getBoundingClientRect().width,
      viewport: innerWidth,
      footerBottom: footer.getBoundingClientRect().bottom,
      height: innerHeight,
      scroll: body.scrollTop,
    };
  });
  expect(geometry.scroll).toBeGreaterThan(0);
  expect(geometry.footerBottom).toBeLessThanOrEqual(geometry.height);
  if (geometry.viewport < 640) expect(geometry.width).toBeCloseTo(geometry.viewport, 1);
  else expect(geometry.width).toBeCloseTo(512, 1);
  await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("Saved");
  await page.screenshot({
    path: `artifacts/surfaces/editor-${test.info().project.name}.png`,
    style: "nextjs-portal { visibility: hidden }",
  });
  if (geometry.viewport < 640) await page.keyboard.press("Escape");
  else await page.locator('[data-slot="sheet-overlay"]').click({ position: { x: 1, y: 1 } });
  await expect(dialog).toBeHidden();
});

test("short decisions fit and actionable feedback is available without hover", async ({ page }) => {
  await page.getByRole("button", { name: "Open short decision" }).click();
  const dialog = page.getByRole("dialog");
  const width = await dialog.evaluate((element) => element.getBoundingClientRect().width);
  expect(width).toBeLessThanOrEqual(384);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Show feedback with an action" }).click();
  await expect(page.locator("[data-preview-notice]")).toHaveCount(0);
  const undo = page.locator("[data-sileo-toast]").getByRole("link", { name: "Undo", exact: true });
  await expect(undo).toBeVisible();
  await undo.click();
  await expect(page.locator("[data-preview-notice]")).toBeVisible();
});

test("segmented tabs distribute full width, hug content and preserve keyboard navigation", async ({
  page,
}) => {
  const bar = page.getByRole("tablist", { name: "Page patterns" });
  const geometry = () =>
    bar.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        width: rect.width,
        parentWidth: element.parentElement!.getBoundingClientRect().width,
        overflows: element.scrollWidth > element.clientWidth,
        left: rect.left,
        firstLeft: element.firstElementChild!.getBoundingClientRect().left,
        tabs: Array.from(element.children).map((child) => child.getBoundingClientRect().width),
      };
    });
  const full = await geometry();
  expect(Math.abs(full.width - full.parentWidth)).toBeLessThan(2);
  if (!full.overflows) expect(Math.max(...full.tabs) - Math.min(...full.tabs)).toBeLessThan(2);
  expect(full.firstLeft).toBeGreaterThanOrEqual(full.left);
  await page.getByRole("button", { name: "Fit tabs", exact: true }).click();
  await expect(bar).toHaveAttribute("data-width", "content");
  const content = await geometry();
  if (content.parentWidth > 600) expect(content.width).toBeLessThan(content.parentWidth);
  expect(content.firstLeft).toBeGreaterThanOrEqual(content.left);
  await bar.getByRole("tab", { name: "Dense list", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(bar.getByRole("tab", { name: "Settings and editing", exact: true })).toBeFocused();
  await expect(page.getByRole("tabpanel", { name: "Settings and editing" })).toBeVisible();
  await page.keyboard.press("End");
  await expect(bar.getByRole("tab", { name: "Operational workspace", exact: true })).toBeFocused();
});

test("outside dismisses both a regular decision and an alert without confirming", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Open short decision", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.waitForTimeout(350);
  await page.locator('[data-slot="dialog-overlay"]').click({ position: { x: 2, y: 2 } });
  await expect(page.getByRole("dialog")).toBeHidden();
  const trigger = page.getByRole("button", { name: "Open confirmation", exact: true });
  await trigger.click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.mouse.click(2, 2);
  await expect(page.getByRole("alertdialog")).toBeHidden();
  await expect(page.locator("[data-preview-notice]")).toBeVisible();
  await trigger.click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alertdialog")).toBeHidden();
  await expect(trigger).toBeFocused();
});
