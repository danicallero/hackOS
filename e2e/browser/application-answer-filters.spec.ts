import { CAPABILITIES } from "../../packages/shared/src/capabilities";
import { expect, shellUser, test } from "./fixtures";

// H13: answer filtering and private response links share the existing review surface.
test("filter answers and dietary needs, then reopen a response by its ID", async ({
  page,
}, testInfo) => {
  const template = [
    {
      key: "university",
      kind: "university",
      label: { en: "University", es: "Universidad", gl: "Universidade" },
      required: false,
    },
    {
      key: "interests",
      kind: "multiselect",
      label: { en: "Interests", es: "Intereses", gl: "Intereses" },
      required: false,
      options: [
        { value: "ai", label: { en: "AI", es: "IA", gl: "IA" } },
        { value: "web", label: { en: "Web", es: "Web", gl: "Web" } },
      ],
    },
  ];
  const responses = [
    {
      id: 10,
      name: "Ada Notes",
      university: 1,
      interests: ["ai"],
      food_intolerances: [],
      food_intolerance_notes: "Allergy",
    },
    {
      id: 11,
      name: "Grace Selected",
      university: 2,
      interests: ["ai", "web"],
      food_intolerances: [1],
      food_intolerance_notes: null,
    },
    {
      id: 12,
      name: "Linus None",
      university: 1,
      interests: ["web"],
      food_intolerances: [],
      food_intolerance_notes: "  ",
    },
  ].map((row) => ({
    ...row,
    user_id: row.id,
    email: `${row.id}@example.test`,
    status: "review",
    responses: { university: row.university, interests: row.interests },
    staff_notes: null,
    submitted_at: "2026-09-18T15:48:00Z",
    decision_sent_at: null,
    confirmation_expires_at: null,
    confirmed_at: null,
    declined_at: null,
    avg_score: null,
    review_count: 0,
    reviews: [],
  }));
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/me/public-profile") return route.fallback();
    const data =
      path === "/api/me"
        ? {
            ...shellUser,
            capabilities: [CAPABILITIES.APPLICATIONS_MANAGE, CAPABILITIES.APPLICATIONS_REVIEW],
          }
        : path === "/api/applications/1"
          ? {
              id: 1,
              name: "Participant form",
              template,
              sections: [],
              grants_role_ids: [],
              description: null,
              open_at: null,
              close_at: null,
              capacity: null,
              confirmation_window_hours: 48,
              ask_shirt_size: false,
              ask_food_intolerances: true,
              current_form_version: 1,
              has_confirmed_responses: false,
            }
          : path === "/api/applications/1/responses"
            ? { responses }
            : path === "/api/public/universities"
              ? {
                  universities: [
                    { id: 1, name: "University A" },
                    { id: 2, name: "University B" },
                  ],
                }
              : path === "/api/public/food-intolerances"
                ? { intolerances: [{ id: 1, label: { en: "Gluten", es: "Gluten", gl: "Glute" } }] }
                : {};
    await route.fulfill({ json: data });
  });
  await page.goto("/applications/1?tab=review");
  const notice = page.locator('aside[aria-labelledby="cookie-notice-title"]');
  if (await notice.isVisible()) await notice.locator("button").click();
  const name = (text: string) => page.getByText(text, { exact: true }).filter({ visible: true });
  await expect(name("Ada Notes")).toBeVisible();
  async function filter(category: string, value: string) {
    await page.getByRole("button", { name: /^Filters/ }).click();
    await page.getByRole("menuitem", { name: category, exact: true }).click();
    await page.getByRole("menuitemcheckbox", { name: value, exact: true }).click();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
  }
  await filter("Dietary restrictions", "With dietary restrictions");
  await expect(name("Linus None")).toHaveCount(0);
  await expect(name("Grace Selected")).toBeVisible();
  await filter("University", "University A");
  await expect(name("Grace Selected")).toHaveCount(0);
  await expect(name("Ada Notes")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("answer-filters.png"), fullPage: true });
  await page.getByRole("button", { name: /^Ada Notes(?:\s|$)/ }).click();
  await expect(page.getByRole("button", { name: "Copy response link", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/response=10/);
  expect(new URL(page.url()).searchParams.size).toBe(2);
  await page.screenshot({ path: testInfo.outputPath("response-link.png"), fullPage: true });
  const href = page.url();
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          (window as Window & { copiedResponseLink?: string }).copiedResponseLink = value;
        },
      },
    });
  });
  await page.getByRole("button", { name: "Copy response link", exact: true }).click();
  expect(
    await page.evaluate(
      () => (window as Window & { copiedResponseLink?: string }).copiedResponseLink,
    ),
  ).toBe(href);
  await page.reload();
  await expect(page.getByRole("button", { name: "Copy response link", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page).not.toHaveURL(/response=/);
  await page.goto(href.replace("tab=review&", ""));
  await expect(page.getByRole("button", { name: "Copy response link", exact: true })).toBeVisible();
  await page.goto("/applications/1?tab=review&response=999");
  await expect(page.getByText("This response is unavailable.", { exact: true })).toBeVisible();
});
