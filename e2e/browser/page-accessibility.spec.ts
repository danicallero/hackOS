import webEn from "../../packages/shared/locales/en/web.json" with { type: "json" };
import { CAPABILITIES } from "../../packages/shared/src/capabilities";
import { expect, shellUser, test } from "./fixtures";

// H10: native radio grouping and explicit invitation field names.
test("invitation settings support radio arrow keys and named fields", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("hackos.cookie-notice.dismissed", "true"));
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/me/public-profile") return route.fallback();
    if (path === "/api/invites/enterprise-options")
      return route.fulfill({ json: { enterprises: [] } });
    const json =
      path === "/api/me"
        ? { ...shellUser, capabilities: [CAPABILITIES.INVITES_MANAGE] }
        : path === "/api/invites/links" && route.request().method() === "POST"
          ? { url: "https://example.test/invitation" }
          : [];
    await route.fulfill({ json });
  });
  await page.goto("/users/invites");
  await expect(page.getByText(webEn.noActiveInvitations, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: webEn.inviteUser, exact: true }).click();
  const dialog = page.getByRole("dialog");
  const method = dialog.getByRole("button", { name: webEn.inviteLink, exact: true });
  await method.focus();
  await page.keyboard.press("Enter");
  await expect(method).toHaveAttribute("aria-pressed", "true");
  const unlimited = dialog.getByRole("radio", { name: webEn.unlimitedRedeems, exact: true });
  await unlimited.focus();
  await page.keyboard.press("ArrowRight");
  await expect(dialog.getByRole("radio", { name: webEn.limitTo, exact: true })).toBeChecked();
  await expect(dialog.getByRole("spinbutton", { name: webEn.uses, exact: true })).toHaveValue("10");
  const week = dialog.getByRole("radio", { name: webEn.sevenDays, exact: true });
  await week.focus();
  await page.keyboard.press("ArrowRight");
  await expect(dialog.getByRole("radio", { name: webEn.custom, exact: true })).toBeChecked();
  await page.keyboard.press("ArrowRight");
  await expect(dialog.getByRole("radio", { name: webEn.never, exact: true })).toBeChecked();
  await expect
    .poll(async () => {
      const box = await dialog.boundingBox();
      return !!box && box.x + box.width <= (page.viewportSize()?.width ?? 0);
    })
    .toBe(true);
  await page.screenshot({ path: `artifacts/invitation-keyboard-${test.info().project.name}.png` });
});
