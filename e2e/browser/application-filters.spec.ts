import { CAPABILITIES } from "../../packages/shared/src/capabilities";
import { expect, shellUser, test } from "./fixtures";

// H12/H36: status choices are OR within their group, combined with text search.
test("response status filters combine selections and reset independently of search", async ({
  page,
}) => {
  const responses = [
    { id: 10, name: "Ada Confirmed", status: "confirmed" },
    { id: 11, name: "Grace Accepted", status: "accepted" },
    { id: 12, name: "Linus Rejected", status: "rejected" },
  ].map((row) => ({
    ...row,
    user_id: row.id,
    email: `${row.id}@example.test`,
    responses: {},
    staff_notes: null,
    submitted_at: "2026-09-18T15:48:00Z",
    decision_sent_at: "2026-09-19T15:48:00Z",
    confirmation_expires_at: null,
    confirmed_at: null,
    declined_at: null,
    avg_score: null,
    review_count: 0,
    reviews: [],
  }));
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const data =
      path === "/api/me"
        ? {
            ...shellUser,
            capabilities: [
              CAPABILITIES.APPLICATIONS_MANAGE,
              CAPABILITIES.APPLICATIONS_REVIEW,
              CAPABILITIES.APPLICATIONS_DECIDE,
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
            ? { responses }
            : {};
    await route.fulfill({ json: data });
  });
  await page.goto("/applications/1?tab=sent");
  const notice = page.locator('aside[aria-labelledby="cookie-notice-title"]');
  if (await notice.isVisible()) await notice.locator("button").click();
  await expect(
    page.getByText("Ada Confirmed", { exact: true }).filter({ visible: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  const status = page.getByRole("menuitem", { name: "Status", exact: true });
  await status.click();
  await page.getByRole("menuitemcheckbox", { name: "Confirmed", exact: true }).click();
  await page.getByRole("menuitemcheckbox", { name: "Acceptance sent", exact: true }).click();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(
    page.getByText("Ada Confirmed", { exact: true }).filter({ visible: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Grace Accepted", { exact: true }).filter({ visible: true }),
  ).toBeVisible();
  await expect(page.getByText("Linus Rejected", { exact: true })).toHaveCount(0);
  await page.getByRole("searchbox").fill("Grace");
  await expect(
    page.getByText("Grace Accepted", { exact: true }).filter({ visible: true }),
  ).toBeVisible();
  await expect(page.getByText("Ada Confirmed", { exact: true })).toHaveCount(0);
  await page.getByRole("searchbox").fill("");
  await page.getByRole("button", { name: "Remove Status: Confirmed", exact: true }).click();
  await expect(page.getByText("Ada Confirmed", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Remove Status: Acceptance sent", exact: true }).click();
  await expect(
    page.getByText("Ada Confirmed", { exact: true }).filter({ visible: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Linus Rejected", { exact: true }).filter({ visible: true }),
  ).toBeVisible();
});
