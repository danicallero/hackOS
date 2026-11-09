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
