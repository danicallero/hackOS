import { mkdir } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { expect, test } from "./fixtures";

// SSR must receive fixtures through HTTP: browser request interception cannot
// exercise the server's audience forwarding or rendering-cache boundary (H17/H60).
test.describe("server-rendered gallery", () => {
  test.skip(
    !process.env.E2E_GALLERY_API_PORT,
    "Run with API_URL and E2E_GALLERY_API_PORT pointing at the isolated SSR fixture",
  );
  let server: Server;
  let opened = false;
  let revealed = false;
  let forwarded = false;
  const project = {
    id: 10,
    name: "Neural Beans",
    description: "Coffee roasting with machine learning.",
    submissionStatus: "submitted",
    responses: { summary: "Coffee roasting with machine learning." },
    template: [
      {
        key: "summary",
        kind: "textarea",
        required: true,
        label: { en: "Summary", es: "Resumen", gl: "Resumo" },
      },
    ],
    sections: [],
    members: [{ userId: 1, name: "Alex", status: "active", photoUrl: null }],
    challenges: [],
    files: [],
  };
  test.beforeAll(async () => {
    server = createServer((request, response) => {
      response.setHeader("content-type", "application/json");
      if (request.url?.startsWith("/api/public/projects")) {
        forwarded ||= request.headers.cookie?.includes("gallery-fixture=attendee") ?? false;
        if (!opened) {
          response.statusCode = 403;
          response.end(JSON.stringify({ error: { code: "forbidden", message: "Gallery closed" } }));
          return;
        }
        response.end(
          JSON.stringify(
            request.url.startsWith("/api/public/projects/10")
              ? {
                  ...project,
                  ...(revealed
                    ? { winners: [{ challengeId: 1, rank: 1, challengeTitle: "Best hack" }] }
                    : {}),
                }
              : { items: [project], total: 1, page: 1, pageSize: 20 },
          ),
        );
        return;
      }
      if (request.url?.startsWith("/api/public/challenges")) {
        response.end(
          JSON.stringify({
            items: [
              { id: 1, title: { en: "Best hack", es: "Mejor hack", gl: "Mellor hack" } },
              { id: 2, title: { en: "Most useful", es: "Más útil", gl: "Máis útil" } },
            ],
          }),
        );
        return;
      }
      response.statusCode = 401;
      response.end(JSON.stringify({ error: { code: "unauthenticated", message: "No session" } }));
    });
    await new Promise<void>((resolve) =>
      server.listen(Number(process.env.E2E_GALLERY_API_PORT), "127.0.0.1", resolve),
    );
  });
  test.afterAll(async () => {
    if (server)
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
  });
  test("rechecks opening and audience on SSR requests and renders safe metadata", async ({
    page,
    context,
  }, info) => {
    await context.addCookies([
      { name: "gallery-fixture", value: "attendee", url: info.project.use.baseURL as string },
    ]);
    opened = false;
    const closed = await page.request.get("/gallery");
    const closedHtml = await closed.text();
    expect(closedHtml).not.toContain("Neural Beans");
    // #1013: API server copy never reaches the page; the localized reason does.
    expect(closedHtml).not.toContain("Gallery closed");
    expect(closedHtml).toContain("No tienes permiso para hacer esto.");
    opened = true;
    // The filter lists the full catalogue even though the page's project has no challenges.
    const listing = await (await page.request.get("/gallery")).text();
    expect(listing).toContain("Mejor hack");
    expect(listing).toContain("Más útil");
    const detail = await page.request.get("/gallery/10");
    const html = await detail.text();
    expect(html).toContain("Neural Beans");
    expect(html).toContain('property="og:title"');
    expect(html).not.toContain("Best hack");
    revealed = true;
    const published = await page.request.get("/gallery/10");
    expect(await published.text()).toContain("Best hack");
    expect(html).not.toContain("/members/1/photo");
    expect(forwarded).toBe(true);
    await page.addInitScript(() => localStorage.setItem("hackos.cookie-notice.dismissed", "true"));
    await page.goto("/gallery/10");
    await expect(page.getByRole("heading", { name: "Neural Beans" })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await mkdir("/tmp/hackos-1011-screenshots", { recursive: true });
    await page.screenshot({
      path: `/tmp/hackos-1011-screenshots/gallery-${info.project.name}.png`,
      fullPage: true,
    });
  });
});
