import { CAPABILITIES } from "../../packages/shared/src/capabilities";
import { installApplicationReviewFixture } from "./application-review-fixture";
import { expect, shellUser, test } from "./fixtures";

// H53: system executor, human initiator and related actions remain distinct.
test("shows private field edits and follows related request actions", async ({ page }, info) => {
  await installApplicationReviewFixture(page.context());
  await page.route("**/api/me", (route) =>
    route.fulfill({ json: { ...shellUser, capabilities: [CAPABILITIES.AUDIT_READ] } }),
  );
  const requestId = "df863fb9-9aa8-4f90-9bc6-6b9b7f712afd";
  const row = {
    id: 1,
    actor_id: null,
    actor_kind: "system",
    initiated_by: 7,
    initiator_name: "Shell Operator",
    actor_name: null,
    actor_surname: null,
    actor_email: null,
    entity_type: "role",
    entity_id: "3",
    action: "assign_user",
    source: "system",
    before: null,
    after: { userId: 22, notes: "[private]" },
    changed_fields: ["userId", "notes"],
    request_id: requestId,
    reason: null,
    ip: null,
    user_agent: null,
    created_at: "2026-11-09T12:00:00Z",
  };
  await page.route("**/api/audit**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/audit/1") return route.fulfill({ json: row });
    if (url.pathname === "/api/audit/actions")
      return route.fulfill({ json: { items: [{ action: "assign_user", entity_type: "role" }] } });
    expect(url.searchParams.get("requestId")).toBe(requestId);
    return route.fulfill({
      json: { items: [row, { ...row, id: 2, action: "set_capabilities" }], total: 2 },
    });
  });
  await page.goto("/audit/1");
  const cookies = page.locator('aside[aria-labelledby="cookie-notice-title"]');
  if (await cookies.isVisible()) await cookies.locator("button").first().click();
  await expect(page.getByText("Initiated by", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Shell Operator" })).toBeVisible();
  await expect(page.getByText("Private value omitted", { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("audit-system-detail.png"), fullPage: true });
  await page.getByRole("link", { name: "View related actions" }).click();
  await expect(page).toHaveURL(new RegExp(`request=${requestId}`));
  await expect(page.getByText("Actions from the same request", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Permissions changed", { exact: true }).filter({ visible: true }),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath("audit-related-actions.png"), fullPage: true });
});

// H53: long real-world field lists must not push the subject and actor offscreen.
test("keeps audit content visible in wide and compact layouts", async ({ page }, info) => {
  await page.addInitScript(() => localStorage.setItem("hackos.cookie-notice.dismissed", "true"));
  await installApplicationReviewFixture(page.context());
  await page.route("**/api/me", (route) =>
    route.fulfill({ json: { ...shellUser, capabilities: [CAPABILITIES.AUDIT_READ] } }),
  );
  const row = {
    id: 3,
    actor_id: 7,
    actor_kind: "user",
    actor_name: "Shell",
    actor_surname: "Operator",
    actor_email: null,
    entity_type: "application",
    entity_id: "1",
    action: "updated",
    source: "admin",
    before: null,
    after: null,
    changed_fields: [
      "ask_food_intolerances",
      "ask_shirt_size",
      "capacity",
      "close_at",
      "confirmation_window_hours",
      "description",
      "grants_role_ids",
      "name",
      "open_at",
      "a_very_long_unbroken_custom_field_identifier_repeated_to_stress_the_table_layout",
    ],
    reason: null,
    ip: null,
    user_agent: null,
    created_at: "2026-11-09T12:00:00Z",
  };
  await page.route("**/api/audit**", (route) =>
    route.fulfill({
      json: new URL(route.request().url()).pathname.endsWith("/actions")
        ? { items: [{ action: "updated", entity_type: "application" }] }
        : {
            items: [row, { ...row, id: 4, action: "created", changed_fields: ["name"] }],
            total: 2,
          },
    }),
  );
  await page.goto("/audit");
  const cookies = page.locator('aside[aria-labelledby="cookie-notice-title"]');
  if (await cookies.isVisible()) await cookies.locator("button").first().click();
  if (info.project.name === "mobile-chromium") {
    await expect(
      page.getByText("Application form #1", { exact: true }).filter({ visible: true }),
    ).toHaveCount(2);
    await page.screenshot({ path: info.outputPath("audit-columns-mobile.png"), fullPage: true });
    return;
  }
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: 1000 });
    if (width === 1024) {
      const rows = page.getByRole("link", { name: /Application form #1/ });
      await expect(rows).toHaveCount(2);
      for (const label of [/^Entity:?$/, /^Actor:?$/, /^Source:?$/])
        await expect(rows.first().getByText(label)).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
        ),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath(`audit-columns-${width}.png`),
        fullPage: true,
      });
      continue;
    }
    const table = page.getByRole("table");
    for (const name of ["When", "Action", "Entity", "Actor", "Source"])
      await expect(table.getByRole("columnheader", { name, exact: true })).toBeInViewport();
    expect(
      await table.evaluate((element) => {
        const wrapper = element.parentElement;
        return wrapper !== null && wrapper.scrollWidth <= wrapper.clientWidth + 1;
      }),
    ).toBe(true);
    await expect(
      table.getByRole("link", { name: "Shell Operator", exact: true }).first(),
    ).toBeInViewport();
    const summary = table.locator("p[title]").first();
    expect(await summary.evaluate((element) => getComputedStyle(element).textOverflow)).toBe(
      "ellipsis",
    );
    expect(await summary.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath(`audit-columns-${width}.png`), fullPage: true });
  }
});

// H53: broadcast copy is public content, distinct from private review notes.
test("shows the text of a public Wallet broadcast", async ({ page }, info) => {
  await page.addInitScript(() => localStorage.setItem("hackos.cookie-notice.dismissed", "true"));
  await installApplicationReviewFixture(page.context());
  await page.route("**/api/me", (route) =>
    route.fulfill({ json: { ...shellUser, capabilities: [CAPABILITIES.AUDIT_READ] } }),
  );
  await page.route("**/api/audit/5", (route) =>
    route.fulfill({
      json: {
        id: 5,
        actor_id: 7,
        actor_kind: "user",
        actor_name: "Shell",
        actor_surname: "Operator",
        actor_email: null,
        entity_type: "wallet_operation",
        entity_id: "df863fb9-9aa8-4f90-9bc6-6b9b7f712afd",
        action: "alert_queued",
        source: "web",
        before: null,
        after: {
          kind: "alert",
          translations: {
            en: { title: "Opening announcement", body: "Doors open at 09:00 in the main hall." },
          },
        },
        changed_fields: ["kind", "translations"],
        reason: null,
        ip: null,
        user_agent: null,
        created_at: "2026-11-09T12:00:00Z",
      },
    }),
  );
  await page.goto("/audit/5");
  await expect(page.getByRole("heading", { name: "Alert queued", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Opening announcement", exact: true })).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "Doors open at 09:00 in the main hall.", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Private value omitted", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("audit-public-broadcast.png"), fullPage: true });
});

// H53: operational identifiers remain evidence; automatic exits are system-originated.
test("shows identifier evidence and system attribution", async ({ page }, info) => {
  await page.addInitScript(() => localStorage.setItem("hackos.cookie-notice.dismissed", "true"));
  await installApplicationReviewFixture(page.context());
  await page.route("**/api/me", (route) =>
    route.fulfill({ json: { ...shellUser, capabilities: [CAPABILITIES.AUDIT_READ] } }),
  );
  const row = {
    id: 6,
    actor_id: null,
    actor_kind: "system",
    actor_name: null,
    actor_surname: null,
    actor_email: null,
    entity_type: "presence",
    entity_id: "42",
    action: "event_end_auto_exit",
    source: "system",
    before: null,
    after: { kind: "out", scannedAt: "2026-11-09T12:00:00Z" },
    changed_fields: ["kind", "scannedAt"],
    reason: null,
    ip: null,
    user_agent: null,
    created_at: "2026-11-09T12:00:00Z",
  };
  await page.route("**/api/audit**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/audit/7")
      return route.fulfill({
        json: {
          ...row,
          id: 7,
          actor_id: 7,
          actor_kind: "user",
          actor_name: "Shell",
          actor_surname: "Operator",
          entity_type: "badge",
          action: "rotate",
          source: "admin",
          before: { badgeId: "BADGE-OLD", email: "old@example.test" },
          after: { badgeId: "BADGE-NEW", email: "new@example.test" },
          changed_fields: ["badgeId", "email"],
        },
      });
    if (path === "/api/audit/actions")
      return route.fulfill({
        json: { items: [{ entity_type: "presence", action: "event_end_auto_exit" }] },
      });
    return route.fulfill({ json: { items: [row], total: 1 } });
  });
  await page.goto("/audit");
  await expect(
    page.getByText("Automatic exit at event end", { exact: true }).filter({ visible: true }),
  ).toBeVisible();
  await expect(page.getByText("System", { exact: true }).filter({ visible: true })).toHaveCount(2);
  await expect(page.getByText("Actor not recorded", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("audit-system-exit.png"), fullPage: true });
  await page.goto("/audit/7");
  for (const value of ["BADGE-OLD", "BADGE-NEW", "old@example.test", "new@example.test"])
    await expect(page.getByRole("cell", { name: value, exact: true })).toBeVisible();
  await expect(page.getByText("Private value omitted", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("audit-identifier-evidence.png"), fullPage: true });
});
