import { CAPABILITIES } from "../../packages/shared/src/capabilities";
import { expect, shellUser, test } from "./fixtures";

// H13: the review modal shows the form's standard view, "view all" reveals
// every answer, and a reviewer's own choice survives a reload.
test("review modal honours the standard view, view all and personal choices", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Application review smoke coverage");

  const user = {
    ...shellUser,
    id: 7,
    language: "en",
    capabilities: [CAPABILITIES.APPLICATIONS_MANAGE, CAPABILITIES.APPLICATIONS_REVIEW],
  };
  const label = (text: string) => ({ en: text, es: text, gl: text });
  const birthYear = new Date().getFullYear() - 22;
  const application = {
    id: 1,
    name: "Participant form",
    granted_role_name: "Participant",
    template: [
      { key: "dni", label: label("National ID"), kind: "text", required: false },
      { key: "born", label: label("Birth year"), kind: "birth_year", required: false },
      { key: "city", label: label("Home city"), kind: "text", required: false },
    ],
    sections: [],
    review_hidden_fields: ["dni"],
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
  const response = {
    id: 10,
    user_id: 22,
    name: "Avery Applicant",
    email: "avery@example.test",
    shirt_size: null,
    food_intolerances: [],
    food_intolerance_notes: null,
    status: "review",
    responses: { dni: "12345678Z", born: birthYear, city: "A Coruña" },
    staff_notes: null,
    submitted_at: "2026-01-01T00:00:00.000Z",
    decision_sent_at: null,
    confirmation_expires_at: null,
    confirmed_at: null,
    declined_at: null,
    avg_score: null,
    review_count: 0,
    reviews: [],
  };

  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/me/public-profile") return route.fallback();
    if (url.pathname === "/api/me") return route.fulfill({ json: user });
    if (url.pathname === "/api/events/stream") {
      return route.fulfill({ status: 200, contentType: "text/event-stream", body: ": ready\n\n" });
    }
    if (url.pathname === "/api/applications/1") return route.fulfill({ json: application });
    if (url.pathname === "/api/applications/1/responses") {
      return route.fulfill({ json: { responses: [response] } });
    }
    if (url.pathname === "/api/public/food-intolerances") {
      return route.fulfill({ json: { intolerances: [] } });
    }
    return route.fulfill({ json: {} });
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/applications/1?tab=review");
  const cookieNotice = page.locator('aside[aria-labelledby="cookie-notice-title"]');
  if (await cookieNotice.isVisible()) await cookieNotice.locator("button").click();
  await page.getByRole("button", { name: "Avery Applicant" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Home city")).toBeVisible();
  await expect(dialog.getByText("National ID")).toHaveCount(0);
  await expect(dialog.getByText("Birth year")).toHaveCount(0);
  await expect(dialog.getByLabel("Age")).toHaveValue("22 years old");

  await dialog.getByRole("button", { name: "View all details" }).click();
  await expect(dialog.getByText("National ID")).toBeVisible();
  await expect(dialog.getByText("Birth year")).toBeVisible();
  await dialog.getByRole("button", { name: "View all details" }).click();

  await dialog.getByRole("button", { name: "Choose visible answers" }).click();
  await page.getByRole("checkbox", { name: "Home city" }).click();
  await page.keyboard.press("Escape");
  await expect(dialog.getByText("Home city")).toHaveCount(0);

  // The response id stays in the URL, so the reload reopens the same modal.
  await page.reload();
  await expect(page.getByRole("dialog").getByText("Age", { exact: true })).toBeVisible();
  await expect(page.getByRole("dialog").getByText("Home city")).toHaveCount(0);
});
