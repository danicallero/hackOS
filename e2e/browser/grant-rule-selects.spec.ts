import { CAPABILITIES } from "../../packages/shared/src/capabilities";
import { expect, shellUser, test } from "./fixtures";

// H8: grant-rule selects must remain inside a stable, usable dialog.
for (const width of [390, 1440]) {
  test(`grant rule dropdowns stay usable at ${width}px`, async ({ page }, info) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript(() => {
      localStorage.setItem("hackos-language", "en");
      localStorage.setItem("hackos.cookie-notice.dismissed", "true");
    });
    const roles = ["Coordinator", "Participant"].map((name, i) => ({
      id: i + 1,
      name,
      position: 10 - i,
      isVisible: true,
      isProtected: false,
      isSeeded: false,
      eventAccess: false,
      deletedAt: null,
      memberIds: [],
      capabilities: [],
    }));
    await page.route("**/api/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/me/public-profile") return route.fallback();
      if (path === "/api/me")
        return route.fulfill({
          json: { ...shellUser, capabilities: [CAPABILITIES.PERMISSIONS_MANAGE] },
        });
      if (path === "/api/roles") return route.fulfill({ json: roles });
      if (path === "/api/role-templates" || path === "/api/role-grant-rules")
        return route.fulfill({ json: [] });
      if (path === "/api/users") return route.fulfill({ json: { users: [], total: 0 } });
      if (path === "/api/enterprises")
        return route.fulfill({ json: { enterprises: [{ id: 1, name: "Sponsor" }] } });
      if (path === "/api/events/stream")
        return route.fulfill({ contentType: "text/event-stream", body: ": ready\n\n" });
      return route.fulfill({ json: {} });
    });
    await page.goto("/permissions?role=1&tab=grantRules");
    await page.getByRole("button", { name: "New rule", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "New rule", exact: true });

    const dialogElement = await dialog.elementHandle();
    async function choose(label: string, name: string, keyboard = false) {
      const trigger = dialog.getByRole("combobox", { name: label, exact: true });
      const triggerElement = await trigger.elementHandle();
      const before = await triggerElement?.boundingBox();
      if (keyboard) {
        await trigger.focus();
        await page.keyboard.press("ArrowDown");
      } else await trigger.click();
      const option = page.getByRole("option", { name, exact: true });
      await expect(option).toBeInViewport();
      expect(await dialogElement?.evaluate((node) => node.scrollLeft)).toBe(0);
      const after = await triggerElement?.boundingBox();
      expect(after?.x).toBeCloseTo(before?.x ?? 0, 0);
      if (label === "Trigger")
        await page.screenshot({ path: info.outputPath("grant-rule-trigger.png") });
      expect(
        await option.evaluate((node) => {
          const box = node.getBoundingClientRect();
          return node.contains(
            document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2),
          );
        }),
      ).toBe(true);
      if (keyboard) await page.keyboard.press("Enter");
      else await option.click();
      await expect(trigger).toContainText(name);
      await expect(trigger).toBeFocused();
    }
    await choose("Trigger type", "Domain event", true);
    await choose("Trigger", "Sponsor linked to an enterprise");
    await choose("Action", "Revoke");
    await choose("Enterprise", "Sponsor");
    await choose("Trigger type", "Role assigned");
    await choose("Source role", "Participant");
    await expect(dialog.getByRole("combobox", { name: "Enterprise", exact: true })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath("grant-rule-role.png") });
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toBeHidden();
  });
}
