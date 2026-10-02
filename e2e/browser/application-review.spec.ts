import { CAPABILITIES } from "../../packages/shared/src/capabilities";
import { expect, shellUser, test } from "./fixtures";

test("staff can upload a CV while editing an application response", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Application review smoke coverage");

  const user = {
    ...shellUser,
    id: 7,
    name: "Review",
    surname: "Operator",
    language: "en",
    capabilities: [
      CAPABILITIES.APPLICATIONS_MANAGE,
      CAPABILITIES.APPLICATIONS_REVIEW,
      CAPABILITIES.APPLICATIONS_EDIT_RESPONSE,
    ],
  };
  const application = {
    id: 1,
    name: "Participant form",
    granted_role_name: "Participant",
    template: [
      {
        key: "cv",
        label: { en: "CV", es: "CV", gl: "CV" },
        kind: "file",
        required: false,
        allowed_file_types: [".pdf"],
        max_file_size_mb: 10,
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
    responses: {},
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
  let storedResponses = response.responses;
  let uploadUrl = "";

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/me") {
      await route.fulfill({ json: user });
    } else if (url.pathname === "/api/events/stream") {
      await route.fulfill({ status: 200, contentType: "text/event-stream", body: ": ready\n\n" });
    } else if (url.pathname === "/api/applications/1" && request.method() === "GET") {
      await route.fulfill({ json: application });
    } else if (url.pathname === "/api/applications/1/responses") {
      await route.fulfill({ json: { responses: [{ ...response, responses: storedResponses }] } });
    } else if (url.pathname === "/api/public/food-intolerances") {
      await route.fulfill({ json: { intolerances: [] } });
    } else if (url.pathname === "/api/applications/1/upload/cv") {
      uploadUrl = request.url();
      storedResponses = { ...storedResponses, cv: "uploads/1/22/cv/test/resume.pdf" };
      await route.fulfill({ json: { key: storedResponses.cv, filename: "resume.pdf" } });
    } else if (url.pathname === "/api/responses/10" && request.method() === "PUT") {
      storedResponses = request.postDataJSON().responses;
      await route.fulfill({ json: { ...response, responses: storedResponses } });
    } else {
      await route.fulfill({ json: {} });
    }
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/applications/1?tab=review");
  const cookieNotice = page.locator('aside[aria-labelledby="cookie-notice-title"]');
  if (await cookieNotice.isVisible()) await cookieNotice.locator("button").click();

  await page.getByRole("button", { name: "Avery Applicant" }).click();
  await expect(page.getByRole("button", { name: "Edit answers" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("application-response-before-edit.png") });

  await page.getByRole("button", { name: "Edit answers" }).click();
  await expect(
    page.getByRole("button", { name: "CV", description: "CV: choose file" }),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("application-response-cv-edit.png") });

  await page
    .locator('input[type="file"]:visible')
    .first()
    .setInputFiles({
      name: "resume.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 fixture"),
    });
  await expect.poll(() => uploadUrl).toContain("responseId=10");
  await expect(page.getByRole("link", { name: "resume.pdf" })).toBeVisible();
});
