import { CAPABILITIES } from "../../packages/shared/src/capabilities";
import { expect, shellUser, test } from "./fixtures";

// Destination feedback and keyboard persistence for issue #849.
for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`statistics destination and preview (${reducedMotion})`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Desktop sortable grid");
    await page.emulateMedia({ reducedMotion });
    await page.setViewportSize({ width: 1440, height: 1000 });
    let savedOrder: string[] = [];
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/me") {
        await route.fulfill({
          json: { ...shellUser, capabilities: [CAPABILITIES.LOGISTICS_STATS] },
        });
      } else if (path === "/api/statistics/scopes") {
        await route.fulfill({
          json: {
            scopes: [
              {
                key: "application:1",
                kind: "application",
                id: 1,
                name: "Participants",
                panelKeys: ["shirt-sizes", "food-intolerances"],
              },
            ],
          },
        });
      } else if (path === "/api/statistics/query") {
        await route.fulfill({
          json: {
            panel_keys: ["shirt-sizes", "food-intolerances"],
            shirt_sizes_confirmed: [{ value: "M", n: 10 }],
            food_intolerances_confirmed: [{ value: "None", n: 8 }],
          },
        });
      } else if (path === "/api/me/ui-prefs" && route.request().method() !== "GET") {
        const body = route.request().postDataJSON();
        savedOrder = body.value?.["application:1"]?.order ?? [];
        await route.fulfill({ json: {} });
      } else {
        await route.fulfill({ json: {} });
      }
    });
    await page.goto("/logistics/stats?tab=before");
    const notice = page.locator('aside[aria-labelledby="cookie-notice-title"]');
    if (await notice.isVisible()) await notice.locator("button").click();
    await page.getByRole("button", { name: "Customize panel", exact: true }).click();
    const handles = page.getByRole("button", { name: /Reorder statistics panel/ });
    await expect(handles).toHaveCount(2);
    if (await notice.isVisible()) await notice.locator("button").click();
    const secondSlot = await handles.nth(1).locator("../..").boundingBox();
    await handles.first().focus();
    await page.keyboard.press("Space");
    await expect(page.locator('[data-drop-placeholder="true"]')).toHaveCount(1);
    await expect(page.locator("[inert][aria-hidden=true]")).toBeVisible();
    await page.keyboard.press("ArrowRight");
    const placeholder = page.locator('[data-drop-placeholder="true"]');
    await expect
      .poll(async () => (await placeholder.boundingBox())?.x)
      .toBeCloseTo(secondSlot!.x, 0);
    await expect(placeholder).toHaveCSS("outline-style", "dashed");
    await expect(placeholder).toHaveCSS("outline-width", "2px");
    if (reducedMotion === "reduce")
      await expect(placeholder).toHaveCSS("transition-property", "none");
    await page.screenshot({
      path: testInfo.outputPath(`statistics-destination-${reducedMotion}.png`),
    });
    await page.keyboard.press("Escape");
    await expect(placeholder).toHaveCount(0);
    await expect.poll(() => savedOrder).toEqual([]);
    await expect(page.locator("[inert][aria-hidden=true]")).toHaveCount(0);
    const source = (await handles.first().boundingBox())!;
    const destination = (await handles.nth(1).boundingBox())!;
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
    await page.mouse.down();
    await page.mouse.move(destination.x + 90, destination.y + 100, { steps: 12 });
    await expect(placeholder).toHaveCount(1);
    await expect
      .poll(async () => (await placeholder.boundingBox())?.x)
      .toBeCloseTo(secondSlot!.x, 0);
    await page.screenshot({ path: testInfo.outputPath(`statistics-pointer-${reducedMotion}.png`) });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await expect(placeholder).toHaveCount(0);

    await expect(page.locator("[inert][aria-hidden=true]")).toHaveCount(0);
    await handles.first().focus();
    await page.keyboard.press("Space");
    await expect(placeholder).toHaveCount(1);
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(async () => (await placeholder.boundingBox())?.x)
      .toBeCloseTo(secondSlot!.x, 0);
    await page.keyboard.press("Space");
    await expect(placeholder).toHaveCount(0);
    await expect.poll(() => savedOrder).toEqual(["food-intolerances", "shirt-sizes"]);
  });
}

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`form destination and keyboard reorder (${reducedMotion})`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Form sortable list");
    await page.emulateMedia({ reducedMotion });
    await page.setViewportSize({ width: reducedMotion === "reduce" ? 390 : 1440, height: 1000 });
    const form = {
      id: 1,
      name: "Participant form",
      granted_role_name: null,
      template: ["First name", "Last name", "Organization"].map((name, i) => ({
        key: `field_${i}`,
        label: { en: name, es: name, gl: name },
        kind: "text",
        required: false,
      })),
      sections: [],
      current_form_version: 1,
      description: null,
      open_at: null,
      close_at: null,
      capacity: null,
      confirmation_window_hours: 168,
      ask_shirt_size: false,
      ask_food_intolerances: false,
      grants_role_ids: [],
      has_confirmed_responses: false,
      created_at: "2026-01-01T00:00:00.000Z",
    };
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/me")
        await route.fulfill({
          json: { ...shellUser, capabilities: [CAPABILITIES.APPLICATIONS_MANAGE] },
        });
      else if (path === "/api/applications/1") await route.fulfill({ json: form });
      else if (path === "/api/roles") await route.fulfill({ json: { roles: [] } });
      else await route.fulfill({ json: {} });
    });
    await page.goto("/applications/1?tab=builder");
    const notice = page.locator('aside[aria-labelledby="cookie-notice-title"]');
    if (await notice.isVisible()) await notice.locator("button").click();
    const handles = page.getByRole("button", { name: "Drag to reorder", exact: true });
    await expect(handles).toHaveCount(3);
    await page
      .getByRole("heading", { name: "Form fields", exact: true })
      .evaluate((heading) => heading.scrollIntoView({ block: "start" }));
    await page.evaluate(() => window.scrollBy(0, -80));
    if (await notice.isVisible()) await notice.locator("button").click();
    const targetY =
      (await handles.nth(1).boundingBox())!.y + (await page.evaluate(() => window.scrollY));
    await handles.first().focus();
    await page.keyboard.press("Space");
    await expect(page.locator('[data-drop-placeholder="true"]')).toHaveCount(1);
    await page.keyboard.press("ArrowDown");
    const placeholder = page.locator('[data-drop-placeholder="true"]');
    await expect(placeholder).toHaveCount(1);
    await expect(placeholder).toHaveCSS("outline-style", "dashed");
    if (reducedMotion === "reduce")
      await expect(placeholder).toHaveCSS("transition-property", "none");
    await expect
      .poll(
        async () =>
          (await handles.first().boundingBox())!.y + (await page.evaluate(() => window.scrollY)),
      )
      .toBeCloseTo(targetY, 0);
    await page.screenshot({ path: testInfo.outputPath(`form-destination-${reducedMotion}.png`) });
    await page.keyboard.press("Space");
    await expect(placeholder).toHaveCount(0);
    await expect(handles.first().locator("../../..")).toContainText("Last name");
    await handles.first().focus();
    await page.keyboard.press("Space");
    await expect(page.locator('[data-drop-placeholder="true"]')).toHaveCount(1);
    await page.keyboard.press("ArrowDown");
    await expect(placeholder).toHaveCSS("outline-style", "dashed");
    await page.keyboard.press("Escape");
    await expect(placeholder).toHaveCount(0);
    await expect(handles.first().locator("../../..")).toContainText("Last name");
    const source = (await handles.first().boundingBox())!;
    const destination = (await handles.nth(1).boundingBox())!;
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
    await page.mouse.down();
    const destinationY = destination.y + (await page.evaluate(() => window.scrollY));
    await page.mouse.move(destination.x + 40, destination.y + 60, { steps: 12 });
    await expect(placeholder).toHaveCount(1);
    await expect(placeholder).toHaveCSS("outline-style", "dashed");
    await expect
      .poll(async () =>
        Math.abs(
          (await handles.first().boundingBox())!.y +
            (await page.evaluate(() => window.scrollY)) -
            destinationY,
        ),
      )
      .toBeLessThan(2);
    await page.screenshot({ path: testInfo.outputPath(`form-pointer-${reducedMotion}.png`) });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await expect(placeholder).toHaveCount(0);
  });
}
