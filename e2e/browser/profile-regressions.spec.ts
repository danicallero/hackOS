import { expect, shellUser, test } from "./fixtures";

// H7, #934, #935: adding the first link must work before any other field is edited.
for (const entry of [
  "/settings/profile?tab=public",
  "/onboarding?step=networking",
  "/onboarding?step=share",
]) {
  test(`photo upload and first social link at ${entry}`, async ({ page }, info) => {
    await page.addInitScript(() => {
      localStorage.setItem("hackos-language", "en");
      sessionStorage.setItem("hackos.onboardingOffered.1", "1");
      localStorage.setItem("hackos.cookie-notice.dismissed", "true");
    });
    let image: string | null = null;
    let uploaded = false;
    await page.route("**/api/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/me") return route.fulfill({ json: { ...shellUser, image } });
      if (path === "/api/me/photo") {
        uploaded =
          route.request().headers()["content-type"].includes("multipart/form-data") &&
          Boolean(route.request().postDataBuffer()?.includes(Buffer.from("avatar.png")));
        image = "/api/users/1/photo?v=new";
        return route.fulfill({ json: { image } });
      }
      if (path === "/api/users/1/photo")
        return route.fulfill({
          contentType: "image/png",
          body: Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=",
            "base64",
          ),
        });
      if (path === "/api/public/event")
        return route.fulfill({ json: { name: "HackUDC", timezone: "Europe/Madrid" } });
      if (path === "/api/me/onboarding")
        return route.fulfill({
          json: {
            eventKey: "test",
            revision: 1,
            steps: [
              {
                step: entry.endsWith("share") ? "share" : "networking",
                status: "pending",
                required: false,
                actions: ["complete", "decline", "defer"],
              },
            ],
          },
        });
      if (path === "/api/me/github")
        return route.fulfill({ json: { configured: true, login: "ana" } });
      if (path === "/api/realtime/stream")
        return route.fulfill({ contentType: "text/event-stream", body: ": connected\n\n" });
      if (path === "/api/me/public-profile")
        return route.fulfill({
          json: {
            directoryVisible: true,
            showSurname: true,
            showPhoto: true,
            showProject: true,
            showGithub: true,
            socials: [],
            headline: null,
            bio: null,
            locationNote: null,
            shareCv: false,
            cv: null,
            consentedAt: "2026-10-01T00:00:00Z",
            onboardingCompletedAt: "2026-10-01T00:00:00Z",
            preview: {
              userId: 1,
              displayName: "Shell Operator",
              socials: [],
              projects: [],
              challenges: [],
            },
          },
        });
      return route.fulfill({ json: {} });
    });
    await page.goto(entry);
    if (!entry.endsWith("share")) {
      await expect(page.locator('input[value="https://github.com/ana"]')).toBeVisible();
      await page.getByRole("button", { name: "Add link", exact: true }).click();
      await expect(page.locator('input[aria-label="Link"]:not([readonly])')).toHaveCount(1);
    }
    const chooser = page.waitForEvent("filechooser");
    await page
      .locator("label")
      .filter({ has: page.locator('input[type="file"]') })
      .click();
    await (await chooser).setFiles({
      name: "avatar.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=",
        "base64",
      ),
    });
    await expect.poll(() => uploaded).toBe(true);
    await expect(page.getByRole("button", { name: "Change photo", exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath("profile-add-social.png"), fullPage: true });
  });
}
