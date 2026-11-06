import { CAPABILITIES } from "../../packages/shared/src/capabilities";
import { expect, shellUser, test } from "./fixtures";

// H13: arrow navigation must not echo reviews or repeatedly reload the response list.
for (const peer of [false, true]) {
  const width = 1920;
  test(`arrow navigation settles with ${peer ? "two review tabs" : "one review tab"}`, async ({
    page,
  }, info) => {
    test.skip(info.project.name === "mobile-chromium", "Review lifecycle regression");
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    const application = {
      id: 1,
      name: "Participant form",
      granted_role_name: "Participant",
      template: [
        { key: "cv", kind: "file", label: { en: "CV", es: "CV", gl: "CV" }, required: false },
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
      created_at: "2026-01-01T00:00:00.000Z",
    };
    let storedScore: number | null = 4;
    let saveCount = 0;
    let responseReads = 0;
    await page.context().route("**/api/**", async (route) => {
      if (new URL(route.request().url()).pathname === "/api/me/public-profile") {
        return route.fulfill({
          json: { onboardingCompletedAt: "2026-10-01T00:00:00.000Z", consentedAt: null },
        });
      }
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
                responses: { cv: "uploads/cv.pdf" },
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
            ].flatMap((row) => [
              row,
              {
                ...row,
                id: 11,
                name: "Blair Applicant",
                reviews: [
                  { author_id: 7, author_name: "Shell Operator", score: 2, notes: "Second review" },
                ],
              },
            ]),
          },
        });
      } else if (path.endsWith("/my-review") && request.method() === "PUT") {
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
    if (peer) {
      const other = await page.context().newPage();
      other.on("pageerror", (error) => errors.push(error.message));
      await other.goto("/applications/1?tab=review&response=10");
      await expect(other.getByRole("dialog", { name: "Avery Applicant" })).toBeVisible();
      await page.bringToFront();
    }
    for (let turn = 0; turn < 5; turn += 1) {
      await page.getByRole("button", { name: "Next candidate" }).filter({ visible: true }).click();
      await expect(page.getByRole("dialog", { name: "Blair Applicant" })).toBeVisible();
      await expect(
        page.getByRole("textbox", { name: "Notes", exact: true }).filter({ visible: true }),
      ).toHaveValue("Second review");
      await page
        .getByRole("button", { name: "Previous candidate" })
        .filter({ visible: true })
        .click();
      await expect(page.getByRole("dialog", { name: "Avery Applicant" })).toBeVisible();
    }
    await page.waitForTimeout(300);
    const settledReads = responseReads;
    await page.waitForTimeout(1500);
    expect(errors).toEqual([]);
    expect(responseReads).toBe(settledReads);
    expect(responseReads).toBe(peer ? 2 : 1);
    expect(saveCount).toBe(0);
    await expect(composer.getByRole("button", { name: "4", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(
      page.getByRole("textbox", { name: "Notes", exact: true }).filter({ visible: true }),
    ).toHaveValue("");
    await page.screenshot({ path: info.outputPath(`review-navigation-stable-${width}.png`) });
  });
}
