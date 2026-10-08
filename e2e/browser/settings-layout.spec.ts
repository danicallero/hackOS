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
          CAPABILITIES.ADMIN_ALL,
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
        venueName: "University campus",
        venueLatitude: 43.3328,
        venueLongitude: -8.4109,
        wifiSsid: "HackUDC",
        wifiPassword: "test-network-password",
        presenceAutoEntryAt: null,
        presenceCertaintyWindowMinutes: 720,
        requireSponsorShirtSize: false,
        requireSponsorDietary: false,
        requireStaffShirtSize: false,
        requireStaffDietary: false,
        passBackFields: [{ label: "Schedule", value: "https://example.com/schedule" }],
        passFieldLabels: {},
        passFieldVisibility: {},
        organizerName: "GPUL",
        judgingStartsAt: null,
        judgingEndsAt: null,
      };
    if (path === "/api/event/wallet")
      body = {
        backgroundColor: "#a3d5ff",
        foregroundColor: "#000000",
        labelColor: "#000000",
        websiteUrl: "https://os.hackudc.com",
        showDirections: true,
        showSchedule: true,
        scheduleUrl: "hackos:///schedule",
        appleAppStoreId: null,
        androidPackageName: "com.example.hackos",
        androidStoreUrl: "https://play.google.com/store/apps/details?id=com.example.hackos",
        appleOptions: {},
        googleClassOptions: {},
        googleObjectOptions: {},
        artwork: {},
        artworkDefaults: {},
      };
    if (path === "/api/me/notification-preferences") {
      body = {
        channels: ["in_app", "email", "push"],
        mandatoryCategories: ["queue"],
        overrides:
          route.request().method() === "PUT" ? route.request().postDataJSON().preferences : [],
      };
    }
    if (path === "/api/event" && route.request().method() === "PUT") {
      body = { ...(body as Record<string, unknown>), ...route.request().postDataJSON() };
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

// H19/H24/H28/H42: every settings category, including the expanded Wallet editor.
for (const tab of ["venue", "wallet", "presence", "invites", "danger"] as const) {
  test(`event settings ${tab} fits the viewport`, async ({ page }) => {
    await page.goto(`/settings/event?tab=${tab}`);
    const cookies = page.locator('aside[aria-labelledby="cookie-notice-title"]');
    await expect(cookies).toBeVisible();
    await cookies.locator("button").first().click();
    const panel = page.getByRole("tabpanel").first();
    if (tab === "danger") await expect(panel.getByRole("heading").first()).toBeVisible();
    else
      await expect(
        panel.getByRole("button", { name: "Save changes", exact: true }).first(),
      ).toBeVisible();
    await expect
      .poll(async () =>
        page
          .getByRole("tab", { selected: true })
          .first()
          .evaluate((element) => {
            const selected = element.getBoundingClientRect();
            const bar = element.closest('[role="tablist"]')?.getBoundingClientRect();
            return !!bar && selected.left >= bar.left - 1 && selected.right <= bar.right + 1;
          }),
      )
      .toBe(true);
    if (tab !== "danger") {
      await expect(panel.getByRole("button", { name: "Save changes", exact: true })).toHaveCount(1);
    }
    if (tab === "venue") {
      const ssid = await panel.getByLabel("Network name", { exact: true }).boundingBox();
      const password = await panel.getByLabel("Password", { exact: true }).boundingBox();
      if (ssid && password && ssid.x !== password.x) {
        expect(Math.abs(ssid.y - password.y)).toBeLessThanOrEqual(1);
        const labels = await panel
          .locator("label")
          .evaluateAll((elements) =>
            elements
              .filter((element) => ["Network name", "Password"].includes(element.textContent ?? ""))
              .map((element) => element.getBoundingClientRect().top),
          );
        expect(Math.abs(labels[0] - labels[1])).toBeLessThanOrEqual(1);
      }
    }
    if (tab === "wallet") {
      await panel.getByRole("button", { name: "Edit back fields" }).click();
      await expect(panel.getByLabel("Organizer", { exact: true })).toBeVisible();
      await expect(panel.getByLabel("Label", { exact: true })).toHaveValue("Schedule");
      await expect(panel.getByLabel("Value", { exact: true })).toHaveValue(
        "https://example.com/schedule",
      );
    }
    if (tab === "presence") {
      await expect(
        panel.getByText(
          "Without an exit or activity in this window, provisional time stops counting.",
        ),
      ).toBeVisible();
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({
      path: `artifacts/settings/${tab}-${test.info().project.name}.png`,
      fullPage: true,
    });
  });
}

for (const [tab, inputLabel] of [
  ["event", "Name"],
  ["venue", "Venue name"],
  ["wallet", "Caption on the pass"],
] as const) {
  test(`event settings ${tab} saves on Enter with success feedback`, async ({ page }) => {
    await page.goto(`/settings/event?tab=${tab}`);
    const cookies = page.locator('aside[aria-labelledby="cookie-notice-title"]');
    await expect(cookies).toBeVisible();
    await cookies.locator("button").first().click();
    const panel = page.getByRole("tabpanel").first();
    const input = panel.getByLabel(inputLabel, { exact: true }).first();
    await expect(input).toBeVisible();
    await input.fill("Edited caption");
    await expect(panel.getByRole("status").filter({ hasText: "Unsaved" })).toBeVisible();
    const walletRequest =
      tab === "wallet"
        ? page.waitForRequest(
            (request) =>
              request.method() === "PUT" && new URL(request.url()).pathname === "/api/event/wallet",
          )
        : null;
    const request = page.waitForRequest(
      (request) => request.method() === "PUT" && new URL(request.url()).pathname === "/api/event",
    );
    await input.press("Enter");
    const body = (await request).postDataJSON();
    if (walletRequest)
      expect((await walletRequest).postDataJSON()).toHaveProperty("backgroundColor");
    if (tab === "event") expect(body.name).toBe("Edited caption");
    if (tab === "venue") expect(body.venueName).toBe("Edited caption");
    if (tab === "wallet") expect(body.passFieldLabels.participant).toBe("Edited caption");
    await expect(panel.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
    await expect(page.locator("[data-sileo-toast]")).toContainText("Saved");
  });
}

test("Wallet appearance saves both resources on Enter through its category owner", async ({
  page,
}) => {
  await page.goto("/settings/event?tab=wallet");
  await page.locator('aside[aria-labelledby="cookie-notice-title"] button').first().click();
  await page.getByRole("tab", { name: "Appearance", exact: true }).click();
  const input = page.getByLabel("Website link", { exact: true });
  await input.fill("https://example.com/new");
  const runtime = page.waitForRequest(
    (request) =>
      request.method() === "PUT" && new URL(request.url()).pathname === "/api/event/wallet",
  );
  const fields = page.waitForRequest(
    (request) => request.method() === "PUT" && new URL(request.url()).pathname === "/api/event",
  );
  await input.press("Enter");
  expect((await runtime).postDataJSON().websiteUrl).toBe("https://example.com/new");
  expect((await fields).postDataJSON()).toHaveProperty("passFieldLabels");
  await expect(page.getByRole("button", { name: "Save changes", exact: true })).toHaveCount(1);
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
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
});

test("queue administrator edits judging hours without reading private event settings", async ({
  page,
}) => {
  let eventReads = 0;
  await page.route("**/api/me", (route) =>
    route.fulfill({ json: { ...shellUser, capabilities: [CAPABILITIES.QUEUE_ADMIN] } }),
  );
  await page.route("**/api/event", (route) => {
    eventReads++;
    return route.fulfill({ status: 403, json: { message: "Forbidden" } });
  });
  await page.route("**/api/queue/settings", (route) =>
    route.fulfill({ json: { schedule_start_at: null, schedule_end_at: null } }),
  );
  await page.goto("/settings/event?tab=judging");
  await page.locator('aside[aria-labelledby="cookie-notice-title"] button').first().click();
  await expect(page.getByRole("tab", { name: "Judging window", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save changes", exact: true })).toBeVisible();
  expect(eventReads).toBe(0);
  const write = page.waitForRequest(
    (request) =>
      request.method() === "PATCH" && new URL(request.url()).pathname === "/api/queue/settings",
  );
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  expect((await write).postDataJSON()).toEqual({ scheduleStartAt: null, scheduleEndAt: null });
  expect(eventReads).toBe(0);
});

test("Wallet keeps edits and shows a retry after a partial save failure", async ({ page }) => {
  let fail = true;
  await page.route("**/api/event", async (route) => {
    if (route.request().method() !== "PUT" || !fail) return route.fallback();
    await new Promise((resolve) => setTimeout(resolve, 250));
    return route.fulfill({
      status: 500,
      json: { error: { code: "internal_error", message: "Fields could not be saved" } },
    });
  });
  await page.goto("/settings/event?tab=wallet");
  await page.locator('aside[aria-labelledby="cookie-notice-title"] button').first().click();
  const caption = page.getByLabel("Caption on the pass", { exact: true }).first();
  await caption.fill("Unsaved attendee caption");
  await page.getByRole("tab", { name: "Appearance", exact: true }).click();
  const website = page.getByLabel("Website link", { exact: true });
  await website.fill("https://example.com/changed");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(website).toBeDisabled();
  await expect(page.getByRole("tabpanel").first().getByRole("alert")).toBeVisible();
  await page.getByRole("tab", { name: "Fields", exact: true }).click();
  await expect(caption).toHaveValue("Unsaved attendee caption");
  fail = false;
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("tabpanel").first().getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
});
