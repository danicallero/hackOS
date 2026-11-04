import { CAPABILITIES } from "../../packages/shared/src/capabilities";
import { expect, shellUser, test } from "./fixtures";

// H22/H24: the narrow directory must expose every operational state before drill-down.
test("logistics directory keeps mixed states visible on narrow screens", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    localStorage.setItem("hackos.cookie-notice.dismissed", "true");
  });
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/me/public-profile") return route.fallback();
    if (path.includes("stream")) {
      return route.fulfill({ contentType: "text/event-stream", body: ": ready\n\n" });
    }
    if (path === "/api/me") {
      return route.fulfill({
        json: {
          ...shellUser,
          capabilities: [CAPABILITIES.ACCREDIT_SCAN, CAPABILITIES.PRESENCE_SCAN],
        },
      });
    }
    if (path === "/api/logistics/people") {
      return route.fulfill({
        json: {
          items: [
            {
              userId: 22,
              name: "Alex",
              surname: "Rivera",
              email: "alex@example.test",
              badgeId: "B-1024",
              confirmed: false,
              eventAccess: false,
              present: true,
            },
          ],
        },
      });
    }
    if (path === "/api/presence/hours") return route.fulfill({ json: [] });
    if (path === "/api/accreditation/stats") return route.fulfill({ json: { byRole: [] } });
    if (path === "/api/accreditation/lookup-user") {
      return route.fulfill({
        json: {
          userId: 22,
          name: "Alex",
          surname: "Rivera",
          email: "alex@example.test",
          confirmed: false,
          hasEventAccess: false,
          alreadyAccredited: true,
          currentBadge: "B-1024",
          intolerances: [],
        },
      });
    }
    return route.fulfill({ json: { items: [], unreadCount: 0 } });
  });
  await page.goto("/logistics/presence?tab=people");
  const person = page.getByRole("button", { name: /Alex Rivera/ });
  await expect(person).toBeVisible();
  for (const label of ["Not confirmed", "No event access", "Currently inside"]) {
    const state = person.getByText(label, { exact: true });
    await expect(state).toBeVisible();
    const bounds = await state.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds?.x).toBeGreaterThanOrEqual(0);
    expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(390);
  }
  await person.click();
  await expect(page).toHaveURL(/tab=scan&userId=22/);
  await expect(page.getByRole("heading", { name: "Alex Rivera", exact: true })).toBeVisible();
});
