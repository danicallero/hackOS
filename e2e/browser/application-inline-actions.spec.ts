import { CAPABILITIES } from "../../packages/shared/src/capabilities";
import { expect, shellUser, test } from "./fixtures";

// Inline accept / reject / send on the responses list (H14).

const user = {
  ...shellUser,
  id: 7,
  name: "Review",
  surname: "Operator",
  capabilities: [
    CAPABILITIES.APPLICATIONS_MANAGE,
    CAPABILITIES.APPLICATIONS_REVIEW,
    CAPABILITIES.APPLICATIONS_DECIDE,
  ],
};
const application = {
  id: 1,
  name: "Participant form",
  granted_role_name: "Participant",
  template: [],
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
const NAMES = [
  "Ada Lovelace",
  "Grace Hopper",
  "Alan Turing",
  "Edsger Dijkstra",
  "Barbara Liskov",
  "Donald Knuth",
  "Margaret Hamilton",
  "Linus Torvalds",
  "Radia Perlman",
  "Ken Thompson",
  "Frances Allen",
  "Dennis Ritchie",
  "Hedy Lamarr",
  "John Backus",
];

function makeRow(index: number, status = "review") {
  return {
    id: index + 1,
    user_id: 100 + index,
    name: NAMES[index],
    email: `${NAMES[index].split(" ")[0].toLowerCase()}@example.test`,
    shirt_size: null,
    food_intolerances: [],
    food_intolerance_notes: null,
    status,
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
}

async function mockApi(page: import("@playwright/test").Page, rows: ReturnType<typeof makeRow>[]) {
  const decisions: string[] = [];
  const control = { failNext: false };
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/me/public-profile") return route.fallback();
    if (url.pathname === "/api/me") return route.fulfill({ json: user });
    if (url.pathname === "/api/events/stream") {
      return route.fulfill({ status: 200, contentType: "text/event-stream", body: ": ready\n\n" });
    }
    if (url.pathname === "/api/applications/1") return route.fulfill({ json: application });
    if (url.pathname === "/api/applications/1/responses") {
      return route.fulfill({ json: { responses: rows } });
    }
    const decide = url.pathname.match(/^\/api\/responses\/(\d+)\/decide$/);
    if (decide && request.method() === "POST") {
      if (control.failNext) {
        control.failNext = false;
        return route.fulfill({
          status: 409,
          json: { error: { code: "conflict", message: "Already decided" } },
        });
      }
      const row = rows.find((candidate) => candidate.id === Number(decide[1]));
      const decision = request.postDataJSON().decision;
      decisions.push(`${decide[1]}:${decision}`);
      if (row) row.status = decision === "accepted" ? "accepted_internal" : "rejected_internal";
      await new Promise((resolve) => setTimeout(resolve, 250));
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ json: {} });
  });
  return { decisions, control };
}

async function openReview(page: import("@playwright/test").Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.goto("/applications/1?tab=review");
  const cookieNotice = page.locator('aside[aria-labelledby="cookie-notice-title"]');
  if (await cookieNotice.isVisible()) await cookieNotice.locator("button").click();
}

for (const viewport of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "narrow", width: 390, height: 844 },
]) {
  test(`pending rows decide inline on ${viewport.name}`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Inline row action smoke coverage");
    const rows = NAMES.map((_, index) => makeRow(index));
    const { decisions, control } = await mockApi(page, rows);
    await openReview(page, viewport.width, viewport.height);

    // The desktop table and the narrow list both exist in the DOM; CSS hides one.
    const list = page.locator(viewport.name === "desktop" ? "table" : "ul.divide-y");
    const visible = (name: string) => list.getByRole("button", { name });
    await expect(visible("Accept: Ada Lovelace")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`${viewport.name}-pending.png`) });

    // Keyboard: focus the action and press Enter; the request carries one decision.
    await visible("Accept: Ada Lovelace").focus();
    await page.keyboard.press("Enter");
    await expect(list.getByText("Accepted internally").first()).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`${viewport.name}-accepted.png`) });

    // Decline another: the row resolves, then leaves the list without a jump.
    await visible("Reject: Grace Hopper").click();
    await expect(list.getByText("Rejected internally").first()).toBeVisible();
    await expect(visible("Accept: Ada Lovelace")).toHaveCount(0, { timeout: 4000 });
    await expect(visible("Accept: Grace Hopper")).toHaveCount(0);
    expect(decisions).toEqual(["1:accepted", "2:rejected"]);

    // Business error: the row rolls back to its actions.
    control.failNext = true;
    await visible("Accept: Alan Turing").click();
    await expect(visible("Accept: Alan Turing")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`${viewport.name}-error.png`) });
  });
}

test("reduced motion swaps and removes rows without a tween, in dark mode", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Inline row action smoke coverage");
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
  const rows = NAMES.map((_, index) => makeRow(index));
  await mockApi(page, rows);
  await openReview(page, 1440, 900);

  const table = page.locator("table");
  await table.getByRole("button", { name: "Accept: Ada Lovelace" }).click();
  await expect(page.locator(".list-swap-out")).toHaveCount(0);
  await expect(table.getByText("Accepted internally").first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("desktop-dark-reduced.png") });
  // Still listed briefly so the marker is seen, then gone with no collapse frame.
  await expect(table.getByText("Accepted internally")).toHaveCount(0, { timeout: 4000 });
  await expect(page.locator('tr[data-motion="closed"]')).toHaveCount(0);
});

test("a collapsing row keeps the surrounding rows in view", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Inline row action smoke coverage");
  const rows = NAMES.map((_, index) => makeRow(index));
  await mockApi(page, rows);
  await openReview(page, 1440, 700);

  const table = page.locator("table");
  const target = table.getByRole("button", { name: "Reject: Frances Allen" });
  await target.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, 220));
  const beforeTop = await table.getByText("Dennis Ritchie").first().boundingBox();
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await target.click();
  await expect(table.getByText("Rejected internally").first()).toBeVisible();
  await expect(table.getByRole("button", { name: "Accept: Frances Allen" })).toHaveCount(0, {
    timeout: 4000,
  });
  const afterTop = await table.getByText("Dennis Ritchie").first().boundingBox();
  const scrollAfter = await page.evaluate(() => window.scrollY);
  // The following row moves up by at most one row height and stays on screen.
  expect(afterTop && beforeTop && beforeTop.y - afterTop.y).toBeLessThanOrEqual(70);
  expect(afterTop?.y ?? -1).toBeGreaterThan(0);
  expect(afterTop?.y ?? 9999).toBeLessThan(700);
  expect(Math.abs(scrollAfter - scrollBefore)).toBeLessThanOrEqual(70);
  await page.screenshot({ path: testInfo.outputPath("desktop-after-collapse.png") });
});
