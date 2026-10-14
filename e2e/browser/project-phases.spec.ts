import { mkdir } from "node:fs/promises";
import { CAPABILITIES } from "../../packages/shared/src/capabilities";
import { expect, shellUser, test } from "./fixtures";

test("project phases share the event category save and event timezone", async ({ page }, info) => {
  let saved: Record<string, unknown> | null = null;
  const config = {
    name: "HackUDC",
    tagline: "",
    timezone: "Europe/Madrid",
    eventStartsAt: null,
    eventEndsAt: null,
    hackingStartsAt: null,
    hackingEndsAt: null,
    showStartCountdown: false,
    eventReminder: null,
    projectDraftsOpenAt: null,
    projectSubmissionsCloseAt: null,
    projectDraftVisibility: "team_only",
    projectGalleryOpensAt: null,
    projectGalleryAudience: "staff",
    projectEditsLockAt: null,
    projectMaxTeamSize: null,
  };
  await page.addInitScript(() => localStorage.setItem("hackos-language", "en"));
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/me")
      return route.fulfill({ json: { ...shellUser, capabilities: [CAPABILITIES.EVENT_MANAGE] } });
    if (path === "/api/event") {
      if (route.request().method() === "PUT") saved = route.request().postDataJSON();
      return route.fulfill({ json: { ...config, ...saved } });
    }
    return route.fulfill({ json: { items: [], total: 0 } });
  });
  await page.goto("/settings/event?tab=event");
  const notice = page.locator('aside[aria-labelledby="cookie-notice-title"]');
  if (await notice.isVisible()) await notice.locator("button").first().click();
  await page.getByRole("tab", { name: "Participants", exact: true }).click();
  await page.getByLabel("Project creation opens").fill("2027-03-05");
  await page
    .getByLabel("Project creation opens")
    .locator("..")
    .locator("input[type=time]")
    .fill("12:00");
  await page.getByLabel("Submissions close").fill("2027-03-07");
  await page
    .getByLabel("Submissions close")
    .locator("..")
    .locator("input[type=time]")
    .fill("12:00");
  await page.getByLabel("Gallery opens").fill("2027-03-07");
  await page.getByLabel("Gallery opens").locator("..").locator("input[type=time]").fill("13:00");
  await page.getByLabel("Maximum team size (optional)").fill("4");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect.poll(() => saved?.projectDraftsOpenAt).toBe("2027-03-05T11:00:00.000Z");
  expect(saved?.name).toBe("HackUDC");
  expect(saved?.projectMaxTeamSize).toBe(4);
  expect(saved).not.toHaveProperty("participantsCanCreateProjects");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await mkdir("/tmp/hackos-1011-screenshots", { recursive: true });
  await page.screenshot({
    path: `/tmp/hackos-1011-screenshots/phases-${info.project.name}.png`,
    fullPage: true,
  });
});
