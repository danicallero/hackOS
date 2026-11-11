import { CAPABILITIES } from "../../packages/shared/src/capabilities";
import { installApplicationReviewFixture } from "./application-review-fixture";
import { expect, shellUser, test } from "./fixtures";

// H53/H13: audit links must survive client navigation and use a permitted workspace.
for (const mode of ["reviewer", "decider", "manager-decider"] as const) {
  test(`audit response link retains the review for ${mode}`, async ({ page }, info) => {
    await installApplicationReviewFixture(page.context());
    await page.route("**/api/me", (route) =>
      route.fulfill({
        json: {
          ...shellUser,
          id: 7,
          capabilities: [
            CAPABILITIES.AUDIT_READ,
            ...(mode === "reviewer"
              ? [CAPABILITIES.APPLICATIONS_REVIEW]
              : [CAPABILITIES.APPLICATIONS_DECIDE]),
            ...(mode === "manager-decider" ? [CAPABILITIES.APPLICATIONS_MANAGE] : []),
          ],
        },
      }),
    );
    await page.route("**/api/responses/10", (route) =>
      route.fulfill({
        json: {
          application: { id: 1 },
          response: { status: "accepted_internal" },
        },
      }),
    );
    await page.route("**/api/audit/1", (route) =>
      route.fulfill({
        json: {
          id: 1,
          actor_id: 7,
          actor_name: "Shell",
          actor_surname: "Operator",
          actor_email: null,
          entity_type: "application_response",
          entity_id: "10",
          action: "review_scored",
          source: "web",
          before: { score: 2 },
          after: {
            score: 4,
            changed_fields: ["score", "notes"],
            last_edited_at: "2026-11-09T12:01:00Z",
          },
          reason: null,
          ip: "127.0.0.1",
          user_agent: null,
          created_at: "2026-11-09T12:00:00Z",
        },
      }),
    );
    await page.goto("/audit/1");
    await expect(
      page.getByText("Private text and answers are not stored in the audit log."),
    ).toBeVisible();
    const notice = page.locator('aside[aria-labelledby="cookie-notice-title"]');
    if (await notice.isVisible()) await notice.locator("button").first().click();
    await page.screenshot({ path: info.outputPath(`audit-detail-${mode}.png`), fullPage: true });
    await page.getByRole("link", { name: "Application response #10" }).click();
    await expect(page).toHaveURL(
      new RegExp(`applications/1\\?tab=${mode === "reviewer" ? "review" : "outbox"}&response=10`),
      { timeout: 15_000 },
    );
    const review = page.getByRole("dialog", { name: "Avery Applicant" });
    await expect(review).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: info.outputPath(`audit-response-${mode}.png`) });
    await page.reload();
    await expect(review).toBeVisible({ timeout: 15_000 });
  });
}
