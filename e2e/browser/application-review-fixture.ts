import type { BrowserContext, Page } from "@playwright/test";
import { CAPABILITIES } from "../../packages/shared/src/capabilities";
import { expect, shellUser } from "./fixtures";

/** H13: shared review API state for score editing and arrow-navigation checks. */
export async function installApplicationReviewFixture(
  context: BrowserContext,
  { navigation = false }: { navigation?: boolean } = {},
) {
  const application = {
    id: 1,
    name: "Participant form",
    granted_role_name: "Participant",
    template: navigation
      ? [{ key: "cv", kind: "file", label: { en: "CV", es: "CV", gl: "CV" }, required: false }]
      : [],
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
  const state = { storedScore: 4 as number | null, saveCount: 0, responseReads: 0 };
  await context.route("**/api/**", async (route) => {
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
      state.responseReads += 1;
      await route.fulfill({
        json: {
          responses: [
            {
              id: 10,
              user_id: 22,
              name: "Avery Applicant",
              email: "avery@example.test",
              status: "review",
              responses: navigation ? { cv: "uploads/cv.pdf" } : {},
              staff_notes: null,
              submitted_at: "2026-01-01T00:00:00.000Z",
              decision_sent_at: null,
              confirmation_expires_at: null,
              confirmed_at: null,
              declined_at: null,
              avg_score: state.storedScore,
              review_count: 1,
              reviews: [
                {
                  author_id: 7,
                  author_name: "Shell Operator",
                  score: state.storedScore,
                  notes: null,
                },
              ],
            },
          ].flatMap((row) =>
            navigation
              ? [
                  row,
                  {
                    ...row,
                    id: 11,
                    name: "Blair Applicant",
                    reviews: [
                      {
                        author_id: 7,
                        author_name: "Shell Operator",
                        score: 2,
                        notes: "Second review",
                      },
                    ],
                  },
                ]
              : [row],
          ),
        },
      });
    } else if (path.endsWith("/my-review") && request.method() === "PUT") {
      state.storedScore = request.postDataJSON().score;
      state.saveCount += 1;
      await route.fulfill({ json: { score: state.storedScore, notes: null } });
    } else if (path === "/api/public/food-intolerances") {
      await route.fulfill({ json: { intolerances: [] } });
    } else {
      await route.fulfill({ json: {} });
    }
  });
  return state;
}

/** H13: enter the shared seeded review and verify its initial composer. */
export async function openApplicationReview(page: Page, width: number) {
  await page.setViewportSize({ width, height: 1000 });
  await page.goto("/applications/1?tab=review");
  const cookies = page.locator('aside[aria-labelledby="cookie-notice-title"]');
  if (await cookies.isVisible()) await cookies.locator("button").first().click();
  await page.getByRole("button", { name: /^Avery Applicant/ }).click();
  const dialog = page.getByRole("dialog", { name: "Avery Applicant" });
  await expect(dialog).toBeVisible();
  const clear = page.getByRole("button", { name: "Clear", exact: true }).filter({ visible: true });
  await expect(clear).toHaveCount(1);
  const composer = clear.locator("..");
  await expect(composer.getByRole("button", { name: "4", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  return { dialog, clear, composer };
}
