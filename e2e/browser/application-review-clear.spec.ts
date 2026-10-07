import { CAPABILITIES } from "../../packages/shared/src/capabilities";
import { expect, shellUser, test } from "./fixtures";

// H12: clearing a score must not dismiss the modal when its composer is detached.
for (const width of [1920, 393]) {
  test(`clearing a review score retains the editor at ${width}px`, async ({ page }, info) => {
    test.skip(
      !["chromium", "webkit"].includes(info.project.name),
      "Pointer/focus regression in Chromium and Safari",
    );
    const application = {
      id: 1,
      name: "Participant form",
      granted_role_name: "Participant",
      template: [],
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
    let storedScore: number | null = 4;
    let saveCount = 0;
    let responseReads = 0;
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path === "/api/me") {
        await route.fulfill({
          json: {
            ...shellUser,
            id: 7,
            capabilities: [CAPABILITIES.APPLICATIONS_REVIEW],
          },
        });
      } else if (path === "/api/events/stream") {
        await route.fulfill({ contentType: "text/event-stream", body: ": ready\n\n" });
      } else if (path === "/api/applications/1") {
        await route.fulfill({ json: application });
      } else if (path === "/api/applications/1/responses") {
        responseReads += 1;
        await route.fulfill({
          json: {
            responses: [
              {
                id: 10,
                user_id: 22,
                name: "Avery Applicant",
                email: "avery@example.test",
                status: "review",
                responses: {},
                staff_notes: null,
                submitted_at: "2026-01-01T00:00:00.000Z",
                decision_sent_at: null,
                confirmation_expires_at: null,
                confirmed_at: null,
                declined_at: null,
                avg_score: storedScore,
                review_count: 1,
                reviews: [
                  { author_id: 7, author_name: "Shell Operator", score: storedScore, notes: null },
                ],
              },
            ],
          },
        });
      } else if (path === "/api/responses/10/my-review" && request.method() === "PUT") {
        storedScore = request.postDataJSON().score;
        saveCount += 1;
        await route.fulfill({ json: { score: storedScore, notes: null } });
      } else if (path === "/api/public/food-intolerances") {
        await route.fulfill({ json: { intolerances: [] } });
      } else {
        await route.fulfill({ json: {} });
      }
    });
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/applications/1?tab=review");
    const cookies = page.locator('aside[aria-labelledby="cookie-notice-title"]');
    if (await cookies.isVisible()) await cookies.locator("button").first().click();
    await page.getByRole("button", { name: /^Avery Applicant/ }).click();
    const dialog = page.getByRole("dialog", { name: "Avery Applicant" });
    await expect(dialog).toBeVisible();
    const clear = page
      .getByRole("button", { name: "Clear", exact: true })
      .filter({ visible: true });
    await expect(clear).toHaveCount(1);
    const composer = clear.locator("..");
    await expect(composer.getByRole("button", { name: "4", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const readsBeforeClear = responseReads;
    await clear.click();
    await expect(dialog).toBeVisible();
    await expect(clear).toBeDisabled();
    await expect.poll(() => saveCount).toBe(1);
    expect(storedScore).toBeNull();
    await expect.poll(() => responseReads).toBeGreaterThan(readsBeforeClear);
    await expect(dialog).toBeVisible();
    await expect(
      page.getByRole("button", { name: "4", exact: true }).filter({ visible: true }),
    ).toHaveAttribute("aria-pressed", "false");
    await expect(
      page.getByRole("textbox", { name: "Notes", exact: true }).filter({ visible: true }),
    ).toBeEditable();
    await page.screenshot({ path: info.outputPath(`review-score-cleared-${width}.png`) });
  });
}
