import { CAPABILITIES } from "../../packages/shared/src/capabilities";
import { expect, shellUser, test } from "./fixtures";

// H13/H27: sorting must settle so client route transitions can commit.
test("sorted review tables can navigate and use the shared statistics query", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  const retiredRequests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (/\/applications\/\d+\/stats/.test(request.url())) retiredRequests.push(request.url());
  });
  const responses = ["Grace", "Ada"].map((name, index) => ({
    id: index + 10,
    user_id: index + 20,
    name,
    email: `${name}@example.test`,
    status: "review",
    responses: {},
    reviews: [],
    avg_score: null,
    review_count: 0,
    staff_notes: null,
    submitted_at: "2026-11-01T12:00:00Z",
    decision_sent_at: null,
    confirmation_expires_at: null,
    confirmed_at: null,
    declined_at: null,
  }));
  let queryCount = 0;
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/me/public-profile") return route.fallback();
    if (path === "/api/events/stream")
      return route.fulfill({ contentType: "text/event-stream", body: ": ready\n\n" });
    if (path === "/api/me")
      return route.fulfill({
        json: {
          ...shellUser,
          capabilities: [
            CAPABILITIES.APPLICATIONS_MANAGE,
            CAPABILITIES.APPLICATIONS_REVIEW,
            CAPABILITIES.LOGISTICS_STATS,
            CAPABILITIES.USERS_READ,
          ],
        },
      });
    if (path === "/api/applications/1")
      return route.fulfill({
        json: {
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
        },
      });
    if (path === "/api/applications/1/responses") return route.fulfill({ json: { responses } });
    if (path === "/api/statistics/query") {
      expect(route.request().postDataJSON()).toEqual({
        scopes: ["application:1"],
        panel_keys: ["overview"],
      });
      queryCount += 1;
      return route.fulfill({ json: { counts_by_status: { review: 2 } } });
    }
    if (path === "/api/users") return route.fulfill({ json: { users: [], total: 0 } });
    return route.fulfill({ json: {} });
  });
  await page.goto("/applications/1?tab=review");
  const notice = page.locator('aside[aria-labelledby="cookie-notice-title"]');
  if (await notice.isVisible()) await notice.locator("button").click();
  await expect(page.getByRole("button", { name: "Ada", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Sort by Applicant", exact: true }).click();
  await expect(page.locator("tbody tr").first()).toContainText("Ada");
  await page.getByRole("button", { name: "Sort by Applicant", exact: true }).click();
  await expect(page.locator("tbody tr").first()).toContainText("Grace");
  await page.getByRole("tab", { name: "Outbox", exact: true }).click();
  await expect(page).toHaveURL(/tab=outbox/);
  await page.getByRole("tab", { name: "Review", exact: true }).click();
  await expect(page).toHaveURL(/tab=review/);
  await expect(page.getByRole("button", { name: "Ada", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Sort by Applicant", exact: true }).click();
  await expect(page.locator("tbody tr").first()).toContainText("Ada");
  await page.screenshot({ path: testInfo.outputPath("review-after-sorting.png"), fullPage: true });
  await page.getByRole("link", { name: "Users", exact: true }).click();
  await expect(page).toHaveURL(/\/users$/);
  await expect(page.getByRole("heading", { name: "Users", exact: true })).toBeVisible();
  expect(queryCount).toBeGreaterThan(0);
  expect(retiredRequests).toEqual([]);
  expect(errors).toEqual([]);
});

for (const isSponsorRep of [false, true]) {
  test(`staff profile meal-plan requests respect sponsor membership: ${isSponsorRep}`, async ({
    page,
  }) => {
    let planReads = 0;
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/me/public-profile") return route.fallback();
      if (path === "/api/events/stream")
        return route.fulfill({ contentType: "text/event-stream", body: ": ready\n\n" });
      if (path === "/api/me")
        return route.fulfill({ json: { ...shellUser, capabilities: [CAPABILITIES.USERS_READ] } });
      if (path === "/api/users/20")
        return route.fulfill({
          json: {
            ...shellUser,
            id: 20,
            name: "Ada",
            surname: "Applicant",
            isSponsorRep,
            foodIntolerances: [],
            foodIntoleranceNotes: null,
            shirtSize: null,
            dni: null,
            badgeId: null,
            image: null,
            createdAt: "2026-11-01T12:00:00Z",
          },
        });
      if (path === "/api/users/20/meal-plan") {
        planReads += 1;
        return route.fulfill({ json: { meals: [], cutoffHours: 24, confirmedAt: null } });
      }
      if (path === "/api/public/food-intolerances")
        return route.fulfill({ json: { intolerances: [] } });
      return route.fulfill({ json: {} });
    });
    await page.goto("/users/20?tab=overview");
    await expect(page.getByRole("heading", { name: "Ada Applicant", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Profile details", exact: true })).toBeVisible();
    if (isSponsorRep) await expect.poll(() => planReads).toBe(1);
    else expect(planReads).toBe(0);
  });
}
