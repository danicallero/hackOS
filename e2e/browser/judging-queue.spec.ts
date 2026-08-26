import { expect, test } from "./fixtures";

const entry = {
  id: 501,
  challenge_id: 41,
  repo_id: 91,
  assigned_room_id: null,
  status: "waiting",
  position: 1,
  priority: 0,
  call_count: 0,
  called_at: null,
  presentation_started_at: null,
  completed_at: null,
  precalled_at: null,
  created_at: "2026-08-26T09:00:00.000Z",
  updated_at: "2026-08-26T09:00:00.000Z",
  repo_name: "Deterministic Team",
};

test("propagates an external judging transition without a page reload", async ({ page }) => {
  let status: "waiting" | "called" = "waiting";

  await page.addInitScript(() => {
    class TestEventSource {
      static instances: TestEventSource[] = [];
      static readonly OPEN = 1;
      readonly listeners = new Map<string, Array<(event: MessageEvent) => void>>();
      readonly readyState = TestEventSource.OPEN;
      onopen: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;

      constructor() {
        TestEventSource.instances.push(this);
        queueMicrotask(() => this.onopen?.());
      }

      addEventListener(name: string, listener: (event: MessageEvent) => void) {
        this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]);
      }

      removeEventListener(name: string, listener: (event: MessageEvent) => void) {
        this.listeners.set(
          name,
          (this.listeners.get(name) ?? []).filter((item) => item !== listener),
        );
      }

      close() {}

      emit(name: string, data: unknown) {
        const event = new MessageEvent(name, { data: JSON.stringify(data) });
        for (const listener of this.listeners.get(name) ?? []) listener(event);
      }
    }

    Object.defineProperty(window, "EventSource", { configurable: true, value: TestEventSource });
    Object.defineProperty(window, "__emitQueueEvent", {
      configurable: true,
      value: (name: string, data: unknown) => {
        for (const source of TestEventSource.instances) source.emit(name, data);
      },
    });
  });

  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/me") {
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          id: 1,
          email: "operator@example.com",
          emailVerified: true,
          name: "Queue",
          surname: "Operator",
          language: "en",
          capabilities: ["queue:operate"],
          role: "staff",
          isEnterpriseJudge: false,
          isSponsorRep: false,
          hasEventAccess: true,
          hasProject: false,
          hasQueueItems: false,
          canCreateProject: false,
          profileLocked: false,
        }),
      });
    }
    if (url.pathname === "/api/tv/rooms") {
      const current = { ...entry, status, assigned_room_id: status === "called" ? 7 : null };
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify([
          {
            room: { id: 7, name: "Room Alpha", slug: "alpha", location: "A1", status: "active" },
            state: {
              room_id: 7,
              is_paused: false,
              max_in_waiting_area: 3,
              desired_minutes_per_team: 5,
            },
            challenge: {
              id: 41,
              title: "Critical Flow",
              enterprise_name: "Fable",
              queue_group_id: 11,
            },
            active: null,
            called: status === "called" ? [current] : [],
            next: status === "waiting" ? [current] : [],
            crossRoomSkips: [],
          },
        ]),
      });
    }
    return route.fulfill({ contentType: "application/json", body: "[]" });
  });

  await page.goto("/queue");
  const room = page.getByRole("region", { name: "Room Alpha" });
  await expect(room).toContainText("Deterministic Team");

  status = "called";
  await page.evaluate(() => {
    const emit = (window as Window & { __emitQueueEvent?: (name: string, data: unknown) => void })
      .__emitQueueEvent;
    emit?.("queue.entry.status_changed", {
      type: "queue.entry.status_changed",
      id: "fixture-transition",
      at: new Date().toISOString(),
      data: { entryId: 501 },
    });
  });

  await expect(room).toContainText("Deterministic Team");
  await expect(room.getByRole("heading", { name: "Waiting room" })).toBeVisible();
  await expect(room.getByRole("button", { name: "More actions" })).toBeVisible();
  expect(await page.evaluate(() => performance.getEntriesByType("navigation").length)).toBe(1);
});
