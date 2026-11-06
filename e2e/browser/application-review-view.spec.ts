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
      {
        key: "city",
        label: label("Home city"),
        kind: "text",
        required: false,
        help_text: label("Tell us where you live"),
      },
      { key: "degree", label: label("University degree"), kind: "degree", required: false },
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
    responses: { dni: "12345678Z", born: birthYear, city: "A Coruña", degree: "101" },
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
      return route.fulfill({
        json: {
          responses: [
            response,
            {
              ...response,
              id: 11,
              user_id: 23,
              name: "Blake Applicant",
              email: "blake@example.test",
              responses: { ...response.responses, degree: "102" },
            },
          ],
        },
      });
    }
    if (url.pathname === "/api/public/degrees") {
      const degrees = [
        { id: 101, name: "Computer Engineering" },
        { id: 102, name: "Mathematics" },
      ];
      const ids = url.searchParams.get("ids")?.split(",");
      return route.fulfill({
        json: { degrees: ids ? degrees.filter((d) => ids.includes(String(d.id))) : degrees },
      });
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
  await expect(dialog.getByRole("combobox", { name: "University degree" })).toHaveText(
    "Computer Engineering",
  );
  await expect(dialog.getByText("Tell us where you live")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Next candidate" }).click();
  await expect(dialog.getByRole("combobox", { name: "University degree" })).toHaveText(
    "Mathematics",
  );
  await dialog.getByRole("button", { name: "Previous candidate" }).click();
  await expect(dialog.getByRole("combobox", { name: "University degree" })).toHaveText(
    "Computer Engineering",
  );
  await page.screenshot({ path: testInfo.outputPath("review-degree-desktop.png") });
  await expect(dialog.getByText("Home city")).toBeVisible();
  await expect(dialog.getByText("National ID")).toHaveCount(0);
  await expect(dialog.getByText("Birth year")).toHaveCount(0);
  await expect(dialog.getByLabel("Age")).toHaveValue("22 years old");

  await page.screenshot({ path: testInfo.outputPath("review-standard-view.png") });
  await dialog.getByRole("button", { name: "View all details" }).click();
  await expect(dialog.getByText("National ID")).toBeVisible();
  await expect(dialog.getByText("Birth year")).toBeVisible();
  await dialog.getByRole("button", { name: "View all details" }).click();

  await dialog.getByRole("button", { name: "Choose visible answers" }).click();
  await expect(page.getByRole("checkbox", { name: "Home city" })).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: testInfo.outputPath("review-choose-answers.png") });
  await page.getByRole("checkbox", { name: "Home city" }).click();
  await page.keyboard.press("Escape");
  await expect(dialog.getByText("Home city")).toHaveCount(0);

  // The response id stays in the URL, so the reload reopens the same modal.
  await page.reload();
  await expect(page.getByRole("dialog").getByText("Age", { exact: true })).toBeVisible();
  await expect(page.getByRole("dialog").getByText("Home city")).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/applications/1?tab=review&response=10");
  await expect(dialog.getByRole("combobox", { name: "University degree" })).toHaveText(
    "Computer Engineering",
  );
  await dialog.getByRole("button", { name: "Next candidate" }).click();
  await expect(dialog.getByRole("combobox", { name: "University degree" })).toHaveText(
    "Mathematics",
  );
  await dialog.getByRole("button", { name: "Previous candidate" }).click();
  await expect(dialog.getByRole("combobox", { name: "University degree" })).toHaveText(
    "Computer Engineering",
  );
  await expect(dialog.getByText("Tell us where you live")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("review-degree-mobile.png") });
});
