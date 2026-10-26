import { CAPABILITIES } from "../../packages/shared/src/capabilities";
import { expect, shellUser, test } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("hackos-language", "en");
    localStorage.setItem("hackos.cookie-notice.dismissed", "true");
  });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/me/public-profile") return route.fallback();
    if (path === "/api/me") {
      return route.fulfill({
        json: { ...shellUser, capabilities: [CAPABILITIES.QUEUE_ADMIN] },
      });
    }
    if (path === "/api/events/stream") {
      return route.fulfill({ contentType: "text/event-stream", body: ": ready\n\n" });
    }
    if (path === "/api/queue/rooms") {
      return route.fulfill({
        json: [
          {
            id: 7,
            name: "North room",
            location: "First floor",
            status: "paused",
            enterprise_id: null,
            enterprise_name: null,
          },
        ],
      });
    }
    if (path === "/api/enterprises") return route.fulfill({ json: { enterprises: [] } });
    if (path === "/api/tv/rooms") return route.fulfill({ json: [] });
    return route.fulfill({ json: {} });
  });
});

for (const entry of ["/queue/rooms", "/queue?tab=configuration"]) {
  test(`room configuration remains interactive at ${entry} (H29, H46)`, async ({ page }) => {
    await page.goto(entry);
    const search = page.getByRole("searchbox", { name: "Filter rooms", exact: true });
    await expect(
      page.getByRole("button", { name: "Edit Room: North room", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Edit Room: North room", exact: true }).click();
    const editor = page.getByRole("textbox", { name: "Edit Room: North room", exact: true });
    await expect(editor).toHaveValue("North room");
    await editor.press("Escape");
    await search.fill("missing");
    await expect(
      page.getByRole("button", { name: "Edit Room: North room", exact: true }),
    ).toHaveCount(0);
    await search.fill("North");
    await expect(
      page.getByRole("button", { name: "Edit Room: North room", exact: true }),
    ).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${entry.replace("?", "\\?")}$`));
  });
}

test("legacy judging window URL redirects to event settings (H39)", async ({ page }) => {
  await page.goto("/queue/rooms?tab=window");
  await expect(page).toHaveURL(/\/settings\/event\?tab=judging$/);
});
