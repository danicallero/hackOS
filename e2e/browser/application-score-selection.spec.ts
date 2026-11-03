import { CAPABILITIES } from "../../packages/shared/src/capabilities";
import { expect, shellUser, test } from "./fixtures";

// H13/H14: select by average across pages; search only returned review notes.
for (const manager of [true, false]) {
  test(`score selection and review search: ${manager ? "manager" : "reviewer"}`, async ({
    page,
  }, testInfo) => {
    const responses = Array.from({ length: 18 }, (_, index) => ({
      id: index + 10,
      user_id: index + 10,
      name: `Applicant ${index + 1}`,
      status: "review",
      email: `${index}@example.test`,
      responses: {},
      staff_notes: null,
      food_intolerances: [],
      food_intolerance_notes: null,
      shirt_size: null,
      submitted_at: "2026-09-18T15:48:00Z",
      decision_sent_at: null,
      confirmation_expires_at: null,
      confirmed_at: null,
      declined_at: null,
      avg_score: index === 17 ? null : index === 16 ? "7.5" : index < 8 ? "8" : "3",
      review_count: index === 17 ? 0 : 1,
      reviews:
        index === 17
          ? []
          : [
              {
                author_id: index === 16 ? 2 : 1,
                author_name: "Reviewer",
                score: 8,
                notes: index === 16 ? "Other reviewer: robotics" : "My review: creative",
                updated_at: "2026-11-03T10:00:00Z",
              },
            ],
    }));
    await page.route("**/api/**", async (route) => {
      if (new URL(route.request().url()).pathname === "/api/me/public-profile") {
        return route.fallback();
      }
      const path = new URL(route.request().url()).pathname;
      const data =
        path === "/api/me"
          ? {
              ...shellUser,
              capabilities: [
                CAPABILITIES.APPLICATIONS_REVIEW,
                ...(manager
                  ? [CAPABILITIES.APPLICATIONS_MANAGE, CAPABILITIES.APPLICATIONS_DECIDE]
                  : []),
              ],
            }
          : path === "/api/applications/1"
            ? {
                id: 1,
                name: "Participant form",
                template: [],
                sections: [],
                grants_role_ids: [],
                description: null,
                open_at: null,
                close_at: null,
                capacity: 100,
                confirmation_window_hours: 48,
                ask_shirt_size: false,
                ask_food_intolerances: false,
                current_form_version: 1,
                has_confirmed_responses: false,
              }
            : path === "/api/applications/1/responses"
              ? {
                  responses: responses.map((row) => ({
                    ...row,
                    reviews: manager
                      ? row.reviews
                      : row.reviews.filter((review) => review.author_id === shellUser.id),
                  })),
                }
              : {};
      await route.fulfill({ json: data });
    });
    await page.goto("/applications/1?tab=review");
    const notice = page.locator('aside[aria-labelledby="cookie-notice-title"]');
    if (await notice.isVisible()) await notice.locator("button").click();
    if (!manager) {
      await expect(page.getByRole("button", { name: "Select by score", exact: true })).toHaveCount(
        0,
      );
      await page.getByRole("searchbox").fill("creative");
      await expect(
        page.getByText("Applicant 1", { exact: true }).filter({ visible: true }),
      ).toBeVisible();
      await page.getByRole("searchbox").fill("robotics");
      await expect(page.getByText("Applicant 17", { exact: true })).toHaveCount(0);
      await page.screenshot({
        path: testInfo.outputPath("reviewer-search.png"),
        animations: "disabled",
      });
      return;
    }
    await expect(page.getByRole("button", { name: "Select by score", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Select by score", exact: true }).click();
    const apply = page.getByRole("button", { name: "Select 0 matches", exact: true });
    await expect(apply).toBeDisabled();
    await page.getByRole("spinbutton", { name: "Score", exact: true }).fill("5");
    await page.screenshot({
      path: testInfo.outputPath("score-selection-desktop.png"),
      animations: "disabled",
    });
    await page.getByRole("button", { name: "Select 9 matches", exact: true }).click();
    await expect(page.getByText("9 selected", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Select by score", exact: true }).click();
    await page.getByRole("combobox", { name: "Average score" }).click();
    await page.getByRole("option", { name: "Less than", exact: true }).click();
    await page.getByRole("button", { name: "Select 8 matches", exact: true }).click();
    await expect(page.getByText("8 selected", { exact: true })).toBeVisible();

    await page.getByRole("searchbox").fill("robotics");
    await expect(
      page.getByText("Applicant 17", { exact: true }).filter({ visible: true }),
    ).toBeVisible();
    await expect(page.getByText("Applicant 1", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Select by score", exact: true }).click();
    await page.getByRole("combobox", { name: "Average score" }).click();
    await page.getByRole("option", { name: "Equal to", exact: true }).click();
    await page.getByRole("spinbutton", { name: "Score", exact: true }).fill("7.5");
    await page.getByRole("button", { name: "Select 1 match", exact: true }).click();
    await expect(page.getByText("1 selected", { exact: true })).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("review-search-selected.png"),
      animations: "disabled",
    });
    await page.getByRole("searchbox").fill("creative");
    await expect(page.getByText("Applicant 17", { exact: true })).toHaveCount(0);
    await expect(
      page.getByText("Applicant 1", { exact: true }).filter({ visible: true }),
    ).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Select by score", exact: true }).click();
    await page.screenshot({
      path: testInfo.outputPath("score-selection-mobile.png"),
      animations: "disabled",
    });
    await expect(page.getByRole("spinbutton", { name: "Score", exact: true })).toBeVisible();
  });
}
