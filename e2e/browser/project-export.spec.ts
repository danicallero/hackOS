import { mkdir } from "node:fs/promises";
import { CAPABILITIES } from "../../packages/shared/src/capabilities";
import { expect, shellUser, test } from "./fixtures";

// H20/H54: the export remains available beside project creation.
for (const canExport of [true, false]) {
  test(`project creation preserves the export action (export permission: ${canExport})`, async ({
    page,
  }, info) => {
    await page.addInitScript(() => {
      localStorage.setItem("hackos-language", "en");
      localStorage.setItem("hackos.cookie-notice.dismissed", "true");
    });
    await page.route("**/api/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/me/public-profile") return route.fallback();
      if (path === "/api/me")
        return route.fulfill({
          json: {
            ...shellUser,
            capabilities: [
              CAPABILITIES.PROJECTS_READ,
              CAPABILITIES.PROJECTS_EDIT,
              ...(canExport ? [CAPABILITIES.EXPORTS_RUN] : []),
            ],
          },
        });
      if (path === "/api/repos")
        return route.fulfill({
          json: {
            repos: [
              {
                id: 10,
                name: "Neural Beans",
                submissionStatus: "submitted",
                members: [{ userId: 1, name: "Daniel", status: "active" }],
              },
            ],
          },
        });
      if (path === "/api/exports/projects.csv")
        return route.fulfill({
          contentType: "text/csv",
          headers: { "Content-Disposition": 'attachment; filename="projects.csv"' },
          body: "Project Name\nNeural Beans\n",
        });
      return route.fulfill({ json: { items: [], unreadCount: 0 } });
    });
    await page.goto("/projects");
    await expect(page.getByRole("button", { name: "Create project", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Neural Beans" })).toBeVisible();
    const exportLink = page.getByRole("link", { name: "Export CSV" });
    if (canExport) {
      await expect(exportLink).toBeVisible();
      await expect(exportLink).toHaveAttribute("href", /\/api\/exports\/projects\.csv$/);
      await mkdir("artifacts/project-export", { recursive: true });
      await page.screenshot({
        path: `artifacts/project-export/actions-${info.project.name}.png`,
        fullPage: true,
      });
      const download = page.waitForEvent("download");
      await exportLink.click();
      expect((await download).suggestedFilename()).toBe("projects.csv");
    } else {
      await expect(exportLink).toHaveCount(0);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}
