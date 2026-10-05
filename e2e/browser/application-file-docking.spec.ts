import { CAPABILITIES } from "../../packages/shared/src/capabilities";
import { expect, shellUser, test } from "./fixtures";

// H12: use the shared statistics DnD contract, including pointer preview and keyboard docking.
for (const width of [1536, 1920]) {
  test(`the application file viewer previews docking at ${width}px`, async ({ page }, info) => {
    test.skip(!["chromium", "webkit"].includes(info.project.name), "Desktop docking regression");
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      const data =
        path === "/api/me"
          ? { ...shellUser, id: 7, capabilities: [CAPABILITIES.APPLICATIONS_REVIEW] }
          : path === "/api/applications/1"
            ? {
                id: 1,
                name: "Participant form",
                granted_role_name: "Participant",
                template: [
                  {
                    key: "cv",
                    label: { en: "CV", es: "CV", gl: "CV" },
                    kind: "file",
                    required: false,
                  },
                ],
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
              }
            : path === "/api/applications/1/responses"
              ? {
                  responses: [
                    {
                      id: 10,
                      user_id: 22,
                      name: "Avery Applicant",
                      email: "avery@example.test",
                      status: "review",
                      responses: { cv: "uploads/cv.png" },
                      staff_notes: null,
                      submitted_at: "2026-01-01T00:00:00Z",
                      decision_sent_at: null,
                      confirmation_expires_at: null,
                      confirmed_at: null,
                      declined_at: null,
                      avg_score: null,
                      review_count: 0,
                      reviews: [],
                    },
                  ],
                }
              : path === "/api/public/food-intolerances"
                ? { intolerances: [] }
                : {};
      if (path === "/api/files/download") {
        await route.fulfill({
          contentType: "image/png",
          body: Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1sAAAAASUVORK5CYII=",
            "base64",
          ),
        });
      } else if (path === "/api/events/stream") {
        await route.fulfill({ contentType: "text/event-stream", body: ": ready\n\n" });
      } else await route.fulfill({ json: data });
    });
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/applications/1?tab=review");
    const cookies = page.locator('aside[aria-labelledby="cookie-notice-title"]');
    if (await cookies.isVisible()) await cookies.locator("button").first().click();
    await page.getByRole("button", { name: /^Avery Applicant/ }).click();
    const dialog = page.getByRole("dialog", { name: "Avery Applicant" });
    const viewer = page.getByRole("complementary", { name: "Application files" });
    await expect(viewer).toHaveAttribute("data-file-viewer-side", "left");
    await dialog.evaluate((element) =>
      Promise.all(
        element.getAnimations().map((animation) => animation.finished.catch(() => undefined)),
      ),
    );
    const grip = viewer.getByRole("button", { name: "Move the file viewer to the right" });
    const sourceBounds = await viewer.boundingBox();
    const dialogBounds = await dialog.boundingBox();
    const box = await grip.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x + 45, box!.y + 45);
    await expect(viewer).toHaveAttribute("data-file-viewer-dragging", "true");
    const overlayBounds = await page.locator("[data-file-viewer-drag-overlay]").boundingBox();
    expect(Math.abs(overlayBounds!.width - sourceBounds!.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(overlayBounds!.height - sourceBounds!.height)).toBeLessThanOrEqual(1);
    expect(await viewer.evaluate((element) => getComputedStyle(element).opacity)).toBe("0");
    const slot = page.locator("[data-file-viewer-preview-slot]");
    await expect(slot).toHaveCount(1);
    const rightX = width - sourceBounds!.x - sourceBounds!.width;
    const pointerY = box!.y + box!.height / 2;
    await page.mouse.move(width * 0.6, pointerY, { steps: 10 });
    await expect(slot).toHaveAttribute("data-file-viewer-preview-slot", "right");
    await expect
      .poll(async () => Math.abs((await slot.boundingBox())!.x - rightX))
      .toBeLessThanOrEqual(1);
    await expect
      .poll(async () => (await dialog.boundingBox())!.x)
      .toBeLessThan(dialogBounds!.x - 400);
    await expect(slot).toHaveCount(1);
    await page.screenshot({ path: info.outputPath("file-viewer-preview-right.png") });

    await page.mouse.move(width * 0.4, pointerY, { steps: 10 });
    await expect(slot).toHaveAttribute("data-file-viewer-preview-slot", "left");
    await expect
      .poll(async () => Math.abs((await slot.boundingBox())!.x - sourceBounds!.x))
      .toBeLessThanOrEqual(1);
    await expect
      .poll(async () => Math.abs((await dialog.boundingBox())!.x - dialogBounds!.x))
      .toBeLessThanOrEqual(1);
    await page.screenshot({ path: info.outputPath("file-viewer-preview-left.png") });

    await page.mouse.move(width * 0.6, pointerY, { steps: 10 });
    await expect
      .poll(async () => Math.abs((await slot.boundingBox())!.x - rightX))
      .toBeLessThanOrEqual(1);
    const destinationBounds = await slot.boundingBox();
    const movedOverlay = await page.locator("[data-file-viewer-drag-overlay]").boundingBox();
    expect(Math.abs(movedOverlay!.y - sourceBounds!.y)).toBeLessThanOrEqual(2);
    await page.mouse.up();
    await expect(viewer).toHaveAttribute("data-file-viewer-side", "right");
    await expect(slot).toHaveCount(0);
    const committedBounds = await viewer.boundingBox();
    for (const dimension of ["x", "y", "width", "height"] as const) {
      expect(
        Math.abs(committedBounds![dimension] - destinationBounds![dimension]),
      ).toBeLessThanOrEqual(1);
    }
    await expect(dialog).toBeVisible();
    await viewer.getByRole("button", { name: "Move the file viewer to the left" }).focus();
    await page.keyboard.press("Space");
    await expect(viewer).toHaveAttribute("data-file-viewer-dragging", "true");
    await page.keyboard.press("ArrowLeft");
    await expect(slot).toHaveAttribute("data-file-viewer-preview-slot", "left");
    await expect(slot).toHaveCount(1);
    await expect(page.locator('div[data-file-viewer-dropzone="left"]')).toHaveAttribute(
      "data-drop-active",
      "true",
    );
    await page.keyboard.press("Space");
    await expect(viewer).toHaveAttribute("data-file-viewer-side", "left");
    await expect(dialog).toBeVisible();
    expect(
      await page.evaluate(() => localStorage.getItem("hackos.application-review.file-viewer-side")),
    ).toBe("left");
    await viewer.getByRole("button", { name: "Move the file viewer to the right" }).focus();
    await page.keyboard.press("Space");
    await expect(viewer).toHaveAttribute("data-file-viewer-dragging", "true");
    await page.keyboard.press("ArrowRight");
    await expect(page.locator('div[data-file-viewer-dropzone="right"]')).toHaveAttribute(
      "data-drop-active",
      "true",
    );
    await expect
      .poll(async () => (await dialog.boundingBox())!.x)
      .toBeLessThan(dialogBounds!.x - 400);
    await page.keyboard.press("Escape");
    await expect(slot).toHaveCount(0);
    await expect
      .poll(async () => Math.abs((await dialog.boundingBox())!.x - dialogBounds!.x))
      .toBeLessThanOrEqual(1);
    await expect(dialog).toBeVisible();
    await expect(viewer).toHaveAttribute("data-file-viewer-side", "left");
    await page.screenshot({ path: info.outputPath("file-viewer-docked.png") });
  });
}
