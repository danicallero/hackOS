import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { CAPABILITIES } from "../../packages/shared/src/capabilities";
import { expect, shellUser, test } from "./fixtures";

const csv = "Project Name\nNeural Beans\n";
const downloadServer = createServer((_request, response) => {
  response.writeHead(200, {
    "Content-Type": "text/csv",
    "Content-Disposition": 'attachment; filename="projects.csv"',
  });
  response.end(csv);
});
let downloadUrl: string;
test.beforeAll(async () => {
  await new Promise<void>((resolve) => downloadServer.listen(0, "127.0.0.1", resolve));
  downloadUrl = `http://127.0.0.1:${(downloadServer.address() as AddressInfo).port}/projects.csv`;
});
test.afterAll(async () => {
  downloadServer.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    downloadServer.close((error) => (error ? reject(error) : resolve())),
  );
});

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
        // H54: use a real attachment response; WebKit does not emit a download
        // event for this intercepted navigation when the body is fulfilled inline.
        return route.continue({ url: downloadUrl });
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
      const file = await download;
      expect(file.suggestedFilename()).toBe("projects.csv");
      const path = await file.path();
      if (!path) throw new Error("Project CSV was not saved");
      expect(await readFile(path, "utf8")).toBe(csv);
    } else {
      await expect(exportLink).toHaveCount(0);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}
