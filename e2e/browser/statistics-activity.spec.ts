import { CAPABILITIES } from "../../packages/shared/src/capabilities";
import { EVENTS } from "../../packages/shared/src/events";
import { expect, shellUser, test } from "./fixtures";

// H24/H27: current occupancy and historical servings are separate populations.
test("activity charts retain scope panels and show live meal coverage", async ({
  page,
}, testInfo) => {
  let extraServing = 0;
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    const controllers = new Set<ReadableStreamDefaultController<Uint8Array>>();
    const fixture = window as typeof window & { emitLogistics?: (type: string) => number };
    fixture.emitLogistics = (type) => {
      for (const controller of controllers) {
        controller.enqueue(
          new TextEncoder().encode(
            `data: ${JSON.stringify({ topic: "logistics", type, id: "1", at: new Date().toISOString(), data: {} })}\n\n`,
          ),
        );
      }
      return controllers.size;
    };
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!url.includes("/api/realtime/stream")) return originalFetch(input, init);
      let controller: ReadableStreamDefaultController<Uint8Array>;
      const body = new ReadableStream<Uint8Array>({
        start(value) {
          controller = value;
          controllers.add(value);
        },
        cancel() {
          controllers.delete(controller);
        },
      });
      return new Response(body, { headers: { "content-type": "text/event-stream" } });
    };
  });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json =
      path === "/api/me"
        ? { ...shellUser, capabilities: [CAPABILITIES.LOGISTICS_STATS] }
        : path === "/api/statistics/scopes"
          ? {
              scopes: [
                {
                  key: "application:1",
                  kind: "application",
                  id: 1,
                  name: "Participants",
                  panelKeys: ["shirt-sizes"],
                },
              ],
            }
          : path === "/api/statistics/query"
            ? { panel_keys: ["shirt-sizes"], shirt_sizes_confirmed: [{ value: "M", n: 10 }] }
            : path === "/api/logistics/stats"
              ? {
                  accreditedCount: 120,
                  currentlyPresent: 100,
                  accreditedByRole: [],
                  meals: [
                    {
                      activityId: 1,
                      name: "Lunch",
                      served: 95 + extraServing,
                      distinctPeople: 80 + extraServing,
                      repeats: 15,
                      presentAttendees: 70 + extraServing,
                    },
                  ],
                  activities: [],
                }
              : path === "/api/logistics/stats/by-staff"
                ? { items: [] }
                : path === "/api/presence/hours"
                  ? []
                  : {};
    await route.fulfill({ json });
  });
  for (const width of [1440, 390]) {
    extraServing = 0;
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/logistics/stats?tab=during");
    const notice = page.locator('aside[aria-labelledby="cookie-notice-title"]');
    if (await notice.isVisible()) await notice.locator("button").click();
    await expect(
      page.getByRole("img", { name: "T-shirt size distribution", exact: true }),
    ).toBeVisible();
    await page.getByRole("row").filter({ hasText: "Lunch" }).click();
    const detail = page.getByRole("dialog", { name: "Lunch" });
    await expect(detail).toBeVisible();
    await expect(
      detail.getByRole("img", { name: "People currently at the event", exact: true }),
    ).toBeVisible();
    await expect(detail.getByRole("term").filter({ hasText: /^Have eaten$/ })).toBeVisible();
    await expect(detail.locator("dd").filter({ hasText: /^70$/ })).toBeVisible();
    await expect(detail.locator("dd").filter({ hasText: /^30$/ })).toBeVisible();
    extraServing = 1;
    await expect
      .poll(() =>
        page.evaluate(
          (type) =>
            (
              window as typeof window & { emitLogistics?: (event: string) => number }
            ).emitLogistics?.(type) ?? 0,
          EVENTS.LOGISTICS_ACTIVITY_SCAN,
        ),
      )
      .toBeGreaterThan(0);
    await expect(detail.locator("dd").filter({ hasText: /^71$/ })).toBeVisible();
    await expect(detail.locator("dd").filter({ hasText: /^29$/ })).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(`meal-detail-${width}.png`),
      animations: "disabled",
    });
    await detail.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("tab", { name: "After", exact: true }).click();
    await expect(
      page.getByRole("img", { name: "T-shirt size distribution", exact: true }),
    ).toBeVisible();
  }
});
