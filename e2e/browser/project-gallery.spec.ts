import { mkdir } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { expect, shellUser, test } from "./fixtures";

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
    responses: { summary: "Coffee roasting with machine learning.", approach: "edge" },
    template: [
      {
        key: "summary",
        kind: "textarea",
        required: true,
        label: { en: "Summary", es: "Resumen", gl: "Resumo" },
      },
      {
        key: "approach",
        kind: "select",
        label: { en: "Approach", es: "Enfoque", gl: "Enfoque" },
        options: [
          {
            value: "edge",
            label: { en: "On device", es: "En el dispositivo", gl: "No dispositivo" },
          },
        ],
      },
      {
        key: "documents",
        kind: "file",
        label: { en: "Documents", es: "Documentos", gl: "Documentos" },
      },
    ],
    sections: [],
    members: [{ userId: 1, name: "Alex", status: "active", photoUrl: null }],
    challenges: [
      "Mejor hack",
      "Impacto social",
      "Sostenibilidad",
      "Tecnología abierta",
      "Accesibilidad",
    ].map((title, index) => ({ id: index + 1, title: { es: title, en: title, gl: title } })),
    files: [
      {
        objectKey: "guide",
        fieldKey: "documents",
        fileName: "Guía.pdf",
        mimeType: "application/pdf",
        url: "/files/guide",
        thumbnailUrl: null,
      },
      {
        objectKey: "results",
        fieldKey: "documents",
        fileName: "Resultados.pdf",
        mimeType: "application/pdf",
        url: "/files/results",
        thumbnailUrl: null,
      },
    ],
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
              : {
                  items: [
                    {
                      ...project,
                      ...(revealed
                        ? { winners: [{ challengeId: 1, rank: 1, challengeTitle: "Mejor hack" }] }
                        : {}),
                    },
                    ...[
                      "Open Routes",
                      "Ocean Watch",
                      "Local Loop",
                      "Green Grid",
                      "Accessible Campus",
                    ].map((name, index) => ({
                      ...project,
                      id: index + 11,
                      name,
                      challenges: project.challenges.slice(0, (index % 4) + 1),
                      members: [
                        ...project.members,
                        { userId: index + 2, name: "María", status: "active", photoUrl: null },
                      ],
                      description: [
                        "Rutas accesibles para moverse por la ciudad.",
                        "Datos abiertos para cuidar nuestras costas.",
                        "Conectamos productores y mercados locales.",
                        "Energía compartida entre vecinos.",
                        "Un campus para todas las personas.",
                      ][index],
                    })),
                  ].filter((item) => {
                    const query = new URL(request.url!, "http://localhost").searchParams;
                    return (
                      (!query.get("search") ||
                        item.name.toLowerCase().includes(query.get("search")!.toLowerCase())) &&
                      (query.get("winnersOnly") !== "true" || (revealed && item.id === 10))
                    );
                  }),
                  total: 6,
                  page: 1,
                  pageSize: 20,
                },
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
    const screenshots = "artifacts/gallery";
    await mkdir(screenshots, { recursive: true });
    revealed = false;
    await page.goto("/gallery");
    await expect(page.getByRole("heading", { name: "Neural Beans" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Iniciar sesión" })).toBeVisible();
    await page.screenshot({
      path: `${screenshots}/public-list-${info.project.name}.png`,
      fullPage: true,
    });
    await page.route("**/api/me", (route) =>
      route.fulfill({ json: { ...shellUser, language: "es" } }),
    );
    await page.route("**/api/notifications/unread-count", (route) =>
      route.fulfill({ json: { count: 0 } }),
    );
    await page.reload();
    await expect(page.locator("[data-sidebar=sidebar]")).toHaveCount(
      info.project.name === "mobile-chromium" ? 0 : 1,
    );
    if (info.project.name === "mobile-chromium") {
      await expect(page.getByRole("button", { name: /barra lateral/i })).toBeVisible();
    } else {
      await expect(page.getByRole("link", { name: "Proyectos", exact: true })).toBeVisible();
    }
    await page.screenshot({ path: `${screenshots}/list-${info.project.name}.png`, fullPage: true });
    const cards = page
      .locator("section")
      .filter({ has: page.getByRole("link", { name: /^Ver proyecto:/ }) });
    const heights = await cards.evaluateAll((elements) =>
      elements.map((element) => Math.round(element.getBoundingClientRect().height)),
    );
    expect(new Set(heights).size).toBe(1);
    await page.getByRole("button", { name: "5 retos", exact: true }).click();
    await expect(page.getByRole("link", { name: "Accesibilidad", exact: true })).toBeVisible();
    await page.screenshot({
      path: `${screenshots}/challenges-${info.project.name}.png`,
      fullPage: true,
    });
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Filtros", exact: true }).click();
    const category = page.getByRole("menuitem", { name: "Retos", exact: true });
    if (info.project.name === "mobile-chromium") await category.click();
    else await category.hover();
    await expect(page.getByRole("menuitemradio", { name: "Más útil", exact: true })).toBeVisible();
    await page.screenshot({
      path: `${screenshots}/filters-${info.project.name}.png`,
      fullPage: true,
    });
    await page.getByRole("menuitemradio", { name: "Más útil", exact: true }).click();
    await expect(page).toHaveURL(/challengeId=2/);
    await expect(page.getByRole("button", { name: /Retos: Más útil/ })).toBeVisible();
    await page.getByRole("searchbox").fill("Neural");
    await page.getByRole("button", { name: "Buscar", exact: true }).click();
    await expect(page).toHaveURL(/search=Neural/);
    await expect(page.getByRole("heading", { name: "Open Routes", exact: true })).toHaveCount(0);
    await page.screenshot({
      path: `${screenshots}/filtered-${info.project.name}.png`,
      fullPage: true,
    });
    revealed = true;
    await page.goto("/gallery");
    await expect(page.getByText("Mejor hack · Puesto 1", { exact: true })).toBeVisible();
    await page.screenshot({
      path: `${screenshots}/winner-list-${info.project.name}.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "Filtros", exact: true }).click();
    await page.getByRole("menuitem", { name: "Solo ganadores", exact: true }).click();
    await page.getByRole("menuitemcheckbox", { name: "Solo ganadores", exact: true }).click();
    await expect(page).toHaveURL(/winnersOnly=true/);
    await expect(page.getByRole("heading", { name: "Open Routes", exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.screenshot({
      path: `${screenshots}/winners-filtered-${info.project.name}.png`,
      fullPage: true,
    });
    await page.getByRole("link", { name: "Ver proyecto: Neural Beans", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Resumen", exact: true })).toHaveCount(0);
    await expect(
      page.getByText("Coffee roasting with machine learning.", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Mejor hack", exact: true })).toBeVisible();
    await expect(page.getByText("Best hack · Puesto 1", { exact: true })).toBeVisible();
    await expect(page.getByText("En el dispositivo", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Guía.pdf", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Resultados.pdf", exact: true })).toBeVisible();
    await page.screenshot({
      path: `${screenshots}/winner-detail-${info.project.name}.png`,
      fullPage: true,
    });
    await page.route("**/api/public/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/public/event")
        return route.fulfill({
          json: { name: "Hackathon", timezone: "Europe/Madrid", showStartCountdown: false },
        });
      if (path === "/api/public/applications") return route.fulfill({ json: { applications: [] } });
      if (path === "/api/public/sponsors")
        return route.fulfill({
          json: { items: [{ enterpriseId: 1, name: "Comunidad", logoUrl: null }] },
        });
      if (path === "/api/public/challenges")
        return route.fulfill({
          json: {
            items: [
              {
                id: 1,
                title: { es: "Mejor hack" },
                description: { es: "Construye algo útil." },
                enterprise: { name: "Comunidad" },
                prizes: [],
              },
            ],
          },
        });
      return route.fulfill({ json: { items: [] } });
    });
    await page.route("**/api/announcements/public", (route) =>
      route.fulfill({
        json: {
          items: [
            {
              id: 1,
              title: "Entrega de premios",
              body: "En el auditorio.",
              screenPlacement: "embedded",
            },
          ],
        },
      }),
    );
    await page.goto("/event");
    await expect(page.getByRole("heading", { name: "Inicio", exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Entrega de premios", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Mejor hack", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Patrocinadores", exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Galería de proyectos", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Programa", exact: true })).toHaveCount(0);
    await expect(page.locator("#applications-title")).toHaveCount(0);
    await page.getByRole("link", { name: "Ver reto: Mejor hack", exact: true }).click();
    await expect(page).toHaveURL(/challenge\/1$/);
    await expect(page.getByRole("navigation", { name: "Inicio", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Mejor hack", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Volver al evento", exact: true }).click();
    await expect(page).toHaveURL(/event$/);
    const eventHeader = await page
      .getByRole("heading", { name: "Inicio", exact: true })
      .boundingBox();
    const eventNavigation = await page
      .getByRole("navigation", { name: "Inicio", exact: true })
      .boundingBox();
    await page.getByRole("link", { name: "Programa", exact: true }).click();
    await expect(page).toHaveURL(/timetable$/);
    const homeHeader = await page
      .getByRole("heading", { name: "Inicio", exact: true })
      .boundingBox();
    const homeNavigation = await page
      .getByRole("navigation", { name: "Inicio", exact: true })
      .boundingBox();
    expect(homeHeader?.x).toBe(eventHeader?.x);
    expect(homeHeader?.y).toBe(eventHeader?.y);
    expect(homeNavigation?.y).toBe(eventNavigation?.y);
    await page.route("**/api/me/notifications**", (route) =>
      route.fulfill({ json: { items: [], total: 0 } }),
    );
    await page.getByRole("link", { name: "Bandeja de entrada", exact: true }).click();
    await expect(page).toHaveURL(/inbox$/);
    const inboxHeader = await page
      .getByRole("heading", { name: "Inicio", exact: true })
      .boundingBox();
    const inboxNavigation = await page
      .getByRole("navigation", { name: "Inicio", exact: true })
      .boundingBox();
    expect(inboxHeader?.x).toBe(eventHeader?.x);
    expect(inboxHeader?.y).toBe(eventHeader?.y);
    expect(inboxNavigation?.y).toBe(eventNavigation?.y);
    await page.getByRole("link", { name: "El evento", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Hackathon", exact: true })).toHaveCount(0);
    await page.screenshot({
      path: `${screenshots}/event-${info.project.name}.png`,
      fullPage: true,
    });
    await page.route("**/api/me", (route) =>
      route.fulfill({ status: 401, json: { error: { code: "unauthenticated" } } }),
    );
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Galería de proyectos", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Galería de proyectos", exact: true }),
    ).toHaveAttribute("href", "/gallery");
    await page.screenshot({
      path: `${screenshots}/landing-${info.project.name}.png`,
      fullPage: true,
    });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
});
