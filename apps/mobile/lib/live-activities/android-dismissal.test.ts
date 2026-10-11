/**
 * #966 (H38, H25): Android Live Update dismissals come only from the
 * notification's delete intent (recorded natively, consumed by JS). A
 * notification missing for any other reason — force-stop, reboot — is posted
 * again, and only real dismissals reach `DELETE /api/me/live-activities/sessions`.
 */
import type { MyLiveActivities, QueueLiveProps } from "@hackos/shared/live-activities";
import { queueLiveLabels } from "@hackos/shared/live-activities";

jest.mock("@/lib/api", () => {
  class ApiError extends Error {
    status: number;
    constructor(message: string, code: number) {
      super(message);
      this.status = code;
    }
  }
  return {
    ApiError,
    apiFetch: jest.fn(),
    getCurrentSessionCookie: jest.fn(() => "session=a"),
  };
});

jest.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 0,
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
}));
jest.mock("expo-notifications", () => ({
  getPermissionsAsync: jest.fn(async () => ({ status: "denied" })),
  getExpoPushTokenAsync: jest.fn(),
}));
jest.mock("expo-crypto", () => ({ randomUUID: () => "device-1" }));

/** Fake Android host: posted notifications plus the native dismissal record. */
jest.mock("./host", () => {
  const posted = new Map<string, string>();
  const recorded: Record<string, string> = {};
  const render = { mode: "promoted" };
  const keyOf = (item: { kind: string; subject: string }) => `${item.kind}:${item.subject}`;
  return {
    posted,
    recorded,
    render,
    liveActivityHost: {
      platform: "android",
      supported: () => true,
      running: () =>
        [...posted.keys()].map((key) => ({
          id: key,
          kind: key.split(":")[0],
          subject: key.slice(key.indexOf(":") + 1),
        })),
      start: jest.fn(async (item: { kind: string; subject: string; props: { phase: string } }) => {
        posted.set(keyOf(item), item.props.phase);
        return keyOf(item);
      }),
      update: jest.fn(
        async (_id: string, item: { kind: string; subject: string; props: { phase: string } }) => {
          posted.set(keyOf(item), item.props.phase);
        },
      ),
      end: jest.fn(async (surface: { id: string }) => {
        posted.delete(surface.id);
      }),
      renderMode: () => render.mode,
      consumeDismissals: jest.fn(() => {
        const copy = { ...recorded };
        for (const key of Object.keys(recorded)) delete recorded[key];
        return copy;
      }),
      dismissEnded: jest.fn(async () => undefined),
      pushToken: async () => null,
      onPushToken: () => undefined,
    },
    subscribePushToStartToken: () => () => undefined,
  };
});

const SESSIONS = "/api/me/live-activities/sessions";
const READ = "/api/me/live-activities";

function queueProps(overrides: Partial<QueueLiveProps> = {}): QueueLiveProps {
  return {
    v: 1,
    kind: "queue",
    phase: "waiting",
    entryId: 3,
    challengeTitle: "Open data",
    position: 4,
    etaMinutes: 12,
    roomName: null,
    roomLocation: null,
    otherQueues: 0,
    url: "hackos://queue",
    labels: queueLiveLabels("en", 0),
    updatedAt: "2026-02-20T10:00:00.000Z",
    ...overrides,
  };
}

const called = () =>
  queueProps({ phase: "called", position: null, etaMinutes: null, roomName: "Room B" });

function response(queue: QueueLiveProps | null): MyLiveActivities {
  return { judgingWindowOpen: true, queue, activities: [] };
}

function load() {
  let sync!: typeof import("./sync");
  let apply!: typeof import("./apply");
  let api!: { apiFetch: jest.Mock };
  let host!: {
    posted: Map<string, string>;
    recorded: Record<string, string>;
    render: { mode: string };
    liveActivityHost: { update: jest.Mock };
  };
  jest.isolateModules(() => {
    sync = require("./sync");
    apply = require("./apply");
    api = require("@/lib/api");
    host = require("./host");
  });
  host.posted.clear();
  for (const key of Object.keys(host.recorded)) delete host.recorded[key];
  let current: MyLiveActivities = response(queueProps());
  api.apiFetch.mockReset();
  api.apiFetch.mockImplementation(async (path: string) => (path === READ ? current : undefined));
  return {
    sync,
    apply,
    apiFetch: api.apiFetch,
    posted: host.posted,
    recorded: host.recorded,
    render: host.render,
    update: host.liveActivityHost.update,
    serve(next: MyLiveActivities) {
      current = next;
    },
  };
}

function deletes(apiFetch: jest.Mock) {
  return apiFetch.mock.calls
    .filter(([url, init]) => url === SESSIONS && init?.method === "DELETE")
    .map(([, init]) => JSON.parse(init.body));
}

/** Lets the fire-and-forget dismissal report settle. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("Android Live Update dismissals (#966)", () => {
  it("reposts a notification that vanished without a dismissal (force-stop, reboot)", async () => {
    const { sync, apiFetch, posted } = load();
    await sync.registerLiveActivityDevice("en");
    await sync.reconcileLiveActivities();
    expect(posted.has("queue:judging")).toBe(true);

    posted.clear(); // force-stop: the system removed it, no delete intent
    await sync.reconcileLiveActivities();
    await flush();

    expect(posted.has("queue:judging")).toBe(true);
    expect(deletes(apiFetch)).toEqual([]);
  });

  it("reports a real dismissal once, with its phase, and keeps it away until the phase changes", async () => {
    const { sync, apiFetch, posted, recorded, serve } = load();
    await sync.registerLiveActivityDevice("en");
    await sync.reconcileLiveActivities();

    posted.delete("queue:judging");
    recorded["queue:judging"] = "waiting"; // delete intent
    await sync.reconcileLiveActivities();
    await flush();
    await sync.reconcileLiveActivities();
    await flush();

    expect(posted.has("queue:judging")).toBe(false);
    expect(deletes(apiFetch)).toEqual([
      { deviceId: "device-1", kind: "queue", subject: "judging", phase: "waiting" },
    ]);

    serve(response(called()));
    await sync.reconcileLiveActivities();
    expect(posted.get("queue:judging")).toBe("called");
  });

  it("retries a dismissal report the API did not accept", async () => {
    const { sync, apiFetch, posted, recorded } = load();
    await sync.registerLiveActivityDevice("en");
    await sync.reconcileLiveActivities();
    posted.delete("queue:judging");
    recorded["queue:judging"] = "waiting";

    apiFetch.mockImplementationOnce(async () => response(queueProps()));
    apiFetch.mockRejectedValueOnce(new Error("offline"));
    await sync.reconcileLiveActivities();
    await flush();
    await sync.reconcileLiveActivities();
    await flush();

    expect(deletes(apiFetch)).toHaveLength(2);
    await sync.reconcileLiveActivities();
    await flush();
    expect(deletes(apiFetch)).toHaveLength(2);
  });

  it("honours a dismissal recorded while no JS ran, in the headless push path", async () => {
    const { apply, sync, apiFetch, posted, recorded } = load();
    recorded["queue:judging"] = "waiting";
    await apply.applyAndroidLiveUpdate({
      event: "update",
      kind: "queue",
      subject: "judging",
      props: queueProps({ position: 3 }),
    });
    expect(posted.has("queue:judging")).toBe(false);

    // The next foreground sync reports it to the API.
    await sync.registerLiveActivityDevice("en");
    await sync.reconcileLiveActivities();
    await flush();
    expect(deletes(apiFetch)).toHaveLength(1);

    await apply.applyAndroidLiveUpdate({
      event: "update",
      kind: "queue",
      subject: "judging",
      props: called(),
    });
    expect(posted.get("queue:judging")).toBe("called");
  });

  it("reposts in the headless push path when the notification vanished without a dismissal", async () => {
    const { apply, posted } = load();
    const message = { event: "update", kind: "queue", subject: "judging" } as const;
    await apply.applyAndroidLiveUpdate({ ...message, props: queueProps() });
    posted.clear();
    await apply.applyAndroidLiveUpdate({ ...message, props: queueProps({ position: 3 }) });
    expect(posted.has("queue:judging")).toBe(true);
  });

  it("reposts unchanged surfaces when the rendering changes (Live updates re-enabled)", async () => {
    const { sync, render, update } = load();
    await sync.registerLiveActivityDevice("en");
    render.mode = "card";
    await sync.reconcileLiveActivities();
    await sync.reconcileLiveActivities();
    const before = update.mock.calls.length;

    render.mode = "promoted";
    await sync.reconcileLiveActivities();
    expect(update.mock.calls.length).toBe(before + 1);
  });
});
