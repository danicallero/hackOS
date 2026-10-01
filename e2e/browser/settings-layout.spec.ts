import { CAPABILITIES } from "../../packages/shared/src/capabilities";
import { expect, shellUser, test } from "./fixtures";

// H3/H51: focused password editing and per-category delivery preferences.
test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = { items: [], total: 0 };
    if (path === "/api/me")
      body = {
        ...shellUser,
        capabilities: [
          CAPABILITIES.EVENT_MANAGE,
          CAPABILITIES.VENUE_MANAGE,
          CAPABILITIES.WALLET_MANAGE,
          CAPABILITIES.PRESENCE_MANAGE,
          CAPABILITIES.INVITES_MANAGE,
        ],
      };
    if (path === "/api/public/food-intolerances") body = { intolerances: [] };
    if (path === "/api/me/removal-eligibility") body = { action: "delete" };
    if (path === "/api/event")
      body = {
        name: "HackUDC",
        tagline: "",
        timezone: "Europe/Madrid",
        participantsCanCreateProjects: false,
        showStartCountdown: true,
        eventStartsAt: null,
        eventEndsAt: null,
        hackingStartsAt: null,
        hackingEndsAt: null,
        participantSelfServiceStartsAt: null,
        participantSelfServiceEndsAt: null,
      };
    if (path === "/api/me/notification-preferences") {
      body = {
        channels: ["in_app", "email", "push"],
        mandatoryCategories: ["queue"],
        overrides:
          route.request().method() === "PUT" ? route.request().postDataJSON().preferences : [],
      };
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
});

test("opens password fields on demand and clears dismissed secrets", async ({ page }) => {
  await page.goto("/settings/profile");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const cookies = page.locator('aside[aria-labelledby="cookie-notice-title"]');
  await expect(cookies).toBeVisible();
  await cookies.locator("button").first().click();
  await expect(cookies).toBeHidden();
  await expect(page.getByLabel("Current password", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Update password", exact: true }).click();
  await page.getByLabel("Current password", { exact: true }).fill("discard-this-secret");
  await page.screenshot({ path: `artifacts/settings/password-${test.info().project.name}.png` });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Update password", exact: true }).click();
  await expect(page.getByLabel("Current password", { exact: true })).toHaveValue("");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.screenshot({
    path: `artifacts/settings/profile-${test.info().project.name}.png`,
    fullPage: true,
  });
});

test("changes optional channels while queue calls stay mandatory", async ({ page }) => {
  await page.goto("/inbox?tab=preferences");
  const cookies = page.locator('aside[aria-labelledby="cookie-notice-title"]');
  await expect(cookies).toBeVisible();
  await cookies.locator("button").first().click();
  await expect(cookies).toBeHidden();
  const trigger = page.getByRole("button", { name: /Notification channels for Announcements/i });
  await expect(trigger).toBeVisible();
  await trigger.click();
  const email = page.getByRole("menuitemcheckbox", { name: "Email", exact: true });
  await expect(email).toBeChecked();
  await email.click();
  await expect(email).not.toBeChecked();
  await page.screenshot({ path: `artifacts/settings/channels-${test.info().project.name}.png` });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Notification channels for Queue/i })).toHaveCount(
    0,
  );
  await page.screenshot({
    path: `artifacts/settings/preferences-${test.info().project.name}.png`,
    fullPage: true,
  });
});

test("event settings fit the viewport", async ({ page }) => {
  await page.goto("/settings/event");
  const cookies = page.locator('aside[aria-labelledby="cookie-notice-title"]');
  await expect(cookies).toBeVisible();
  await cookies.locator("button").first().click();
  await expect(cookies).toBeHidden();
  await expect(page.getByRole("textbox").first()).toHaveValue("HackUDC");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: `artifacts/settings/event-${test.info().project.name}.png`,
    fullPage: true,
  });
});

test("searches activities and subscribes from the reminder dialog", async ({ page }) => {
  await page.route("**/api/public/activities", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: 42,
            title: "Building with sensors",
            type: "workshop",
            startsAt: "2099-10-01T10:00:00Z",
            endsAt: "2099-10-01T11:00:00Z",
          },
          {
            id: 43,
            title: "Opening ceremony",
            type: "ceremony",
            startsAt: "2099-10-01T09:00:00Z",
            endsAt: "2099-10-01T09:30:00Z",
          },
        ],
      },
    }),
  );
  await page.goto("/inbox?tab=preferences");
  const cookies = page.locator('aside[aria-labelledby="cookie-notice-title"]');
  await expect(cookies).toBeVisible();
  await cookies.locator("button").first().click();
  await expect(cookies).toBeHidden();
  await page.getByRole("button", { name: "Add reminder", exact: true }).click();
  await page.getByRole("combobox", { name: "Activity", exact: true }).click();
  await page.getByPlaceholder("Type to filter…").fill("sensors");
  await expect(page.getByRole("option", { name: /Opening ceremony/ })).toHaveCount(0);
  await page.screenshot({
    path: `artifacts/settings/reminder-picker-${test.info().project.name}.png`,
  });
  const request = page.waitForRequest(
    (request) => request.method() === "PUT" && request.url().includes("notification-preferences"),
  );
  await page.getByPlaceholder("Type to filter…").press("ArrowDown");
  await page.getByPlaceholder("Type to filter…").press("Enter");
  expect((await request).postDataJSON().preferences).toEqual([
    { category: "schedule:42", channel: "in_app", enabled: true },
    { category: "schedule:42", channel: "email", enabled: true },
    { category: "schedule:42", channel: "push", enabled: true },
  ]);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /Remove reminder.*Building with sensors/i }),
  ).toBeVisible();
  await page.screenshot({
    path: `artifacts/settings/reminders-${test.info().project.name}.png`,
    fullPage: true,
  });
});

test("expands a message and keeps deletion behind confirmation", async ({ page }) => {
  const item = {
    id: 99,
    category: "announcements",
    payload: {
      subject: "Dinner is ready",
      body: "Join us in the dining hall.\nVegetarian options are available.",
      roomName: "Dining hall",
    },
    read_at: null,
    created_at: "2026-10-01T18:00:00Z",
  };
  await page.route("**/api/me/notifications?**", (route) =>
    route.fulfill({
      json: {
        items: [
          item,
          {
            ...item,
            id: 100,
            read_at: item.created_at,
            payload: {
              subject: "Workshop starts in 15 minutes",
              body: "Building with sensors · Room 2",
            },
          },
          {
            ...item,
            id: 101,
            read_at: item.created_at,
            payload: {
              subject: "Application confirmed",
              body: "Your spot at HackUDC is confirmed.",
            },
          },
        ],
        total: 3,
      },
    }),
  );
  await page.goto("/inbox");
  const cookies = page.locator('aside[aria-labelledby="cookie-notice-title"]');
  await expect(cookies).toBeVisible();
  await cookies.locator("button").first().click();
  await expect(cookies).toBeHidden();
  const message = page.getByRole("button", { name: /Dinner is ready/ });
  await expect(message).toHaveAttribute("aria-expanded", "false");
  await page.screenshot({
    path: `artifacts/settings/messages-${test.info().project.name}.png`,
    fullPage: true,
  });
  const read = page.waitForRequest(
    (request) => request.url().includes("/99/read") && request.method() === "POST",
  );
  await message.click();
  await read;
  await expect(message).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#message-99")).toContainText("Vegetarian options are available.");
  await page.screenshot({
    path: `artifacts/settings/message-open-${test.info().project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: /Delete this message/i }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
});
