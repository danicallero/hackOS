/**
 * #966 (H38, H25/H26): foreground Live Activity orchestration against a fake
 * platform host — sign-out ordering, stale reconciles, registration retries
 * and APIs that predate the module.
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
  getPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
}));
jest.mock("expo-crypto", () => ({ randomUUID: () => "device-1" }));

jest.mock("./host", () => {
  const surfaces: { id: string; kind: "queue" | "activity"; subject: string | null }[] = [];
  let next = 0;
  return {
    surfaces,
    liveActivityHost: {
      platform: "ios",
      supported: () => true,
      running: () => surfaces.map((surface) => ({ ...surface })),
      start: jest.fn(async (item: { kind: "queue" | "activity"; subject: string }) => {
        next += 1;
        const id = `a${next}`;
        surfaces.push({ id, kind: item.kind, subject: item.subject });
        return id;
      }),
      update: jest.fn(async () => undefined),
      end: jest.fn(async (surface: { id: string }) => {
        const index = surfaces.findIndex((candidate) => candidate.id === surface.id);
        if (index >= 0) surfaces.splice(index, 1);
      }),
      dismissEnded: jest.fn(async () => undefined),
      pushToken: async () => null,
      onPushToken: () => undefined,
    },
    subscribePushToStartToken: () => () => undefined,
  };
});

type Sync = typeof import("./sync");

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

function response(queue: QueueLiveProps | null): MyLiveActivities {
  return { judgingWindowOpen: true, queue, activities: [] };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Fresh module state per test: sync.ts keeps its registration in module scope. */
function load() {
  let sync!: Sync;
  let api!: { apiFetch: jest.Mock; ApiError: new (message: string, status: number) => Error };
  let host!: { surfaces: unknown[]; liveActivityHost: { dismissEnded: jest.Mock } };
  let events!: typeof import("@/lib/sign-out-events");
  jest.isolateModules(() => {
    sync = require("./sync");
    api = require("@/lib/api");
    host = require("./host");
    events = require("@/lib/sign-out-events");
  });
  return {
    sync,
    apiFetch: api.apiFetch,
    ApiError: api.ApiError,
    surfaces: host.surfaces,
    dismissEnded: host.liveActivityHost.dismissEnded,
    events,
  };
}

function callsTo(apiFetch: jest.Mock, path: string, method = "GET") {
  return apiFetch.mock.calls.filter(
    ([url, init]) => url === path && (init?.method ?? "GET") === method,
  );
}

const DEVICE = "/api/me/live-activities/device";
// `deviceId` lets the server apply this device's maxConcurrent cut.
const READ = "/api/me/live-activities?deviceId=device-1";

describe("Live Activity sync (#966)", () => {
  it("switches device delivery off with the old session before sign-out revokes it", async () => {
    const { sync, apiFetch, events } = load();
    apiFetch.mockResolvedValue(undefined);
    await sync.registerLiveActivityDevice("en");
    events.registerSignOutListener(() => sync.signOutLiveActivities());

    const put = deferred<undefined>();
    apiFetch.mockReturnValueOnce(put.promise);
    let settled = false;
    const cleanup = events.notifySignOut().then(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const [, init] = callsTo(apiFetch, DEVICE, "PUT").at(-1)!;
    expect(JSON.parse(init.body)).toMatchObject({ deviceId: "device-1", enabled: false });
    expect(init.sessionCookie).toBe("session=a");
    expect(settled).toBe(false);

    put.resolve(undefined);
    await cleanup;
    expect(settled).toBe(true);
  });

  it("removes finished surfaces still on the Lock Screen at sign-out", async () => {
    const { sync, apiFetch, dismissEnded } = load();
    apiFetch.mockResolvedValue(undefined);
    await sync.registerLiveActivityDevice("en");
    await sync.signOutLiveActivities();
    expect(dismissEnded).toHaveBeenCalledTimes(1);
  });

  it("does not repaint surfaces from a read that was in flight at sign-out", async () => {
    const { sync, apiFetch, surfaces } = load();
    apiFetch.mockResolvedValue(undefined);
    await sync.registerLiveActivityDevice("en");

    const read = deferred<MyLiveActivities>();
    apiFetch.mockReturnValueOnce(read.promise);
    const reconcile = sync.reconcileLiveActivities();
    await sync.signOutLiveActivities();
    read.resolve(response(queueProps()));

    await expect(reconcile).resolves.toEqual([]);
    expect(surfaces).toHaveLength(0);
  });

  it("never lets an older read overwrite a newer one", async () => {
    const { sync, apiFetch, surfaces } = load();
    apiFetch.mockResolvedValue(undefined);
    await sync.registerLiveActivityDevice("en");

    const older = deferred<MyLiveActivities>();
    const newer = deferred<MyLiveActivities>();
    apiFetch.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const first = sync.reconcileLiveActivities();
    const second = sync.reconcileLiveActivities();

    newer.resolve(response(null));
    await second;
    older.resolve(response(queueProps()));
    await first;

    expect(surfaces).toHaveLength(0);
  });

  it("retries a failed device registration on the next reconcile", async () => {
    const { sync, apiFetch } = load();
    apiFetch.mockRejectedValueOnce(new Error("offline"));
    await expect(sync.registerLiveActivityDevice("en")).rejects.toThrow("offline");

    apiFetch.mockImplementation(async (path: string) =>
      path === READ ? response(null) : undefined,
    );
    await sync.reconcileLiveActivities();
    expect(callsTo(apiFetch, DEVICE, "PUT")).toHaveLength(2);

    await sync.reconcileLiveActivities();
    expect(callsTo(apiFetch, DEVICE, "PUT")).toHaveLength(2);
  });

  it("goes quiet against an API without the module until the next sign-in", async () => {
    const { sync, apiFetch, ApiError } = load();
    apiFetch.mockRejectedValue(new ApiError("Not found", 404));
    await expect(sync.registerLiveActivityDevice("en")).rejects.toThrow("Not found");

    await expect(sync.reconcileLiveActivities()).resolves.toEqual([]);
    await expect(sync.reconcileLiveActivities()).resolves.toEqual([]);
    expect(apiFetch).toHaveBeenCalledTimes(1);

    apiFetch.mockImplementation(async (path: string) =>
      path === READ ? response(null) : undefined,
    );
    await sync.registerLiveActivityDevice("en");
    await sync.reconcileLiveActivities();
    expect(callsTo(apiFetch, READ)).toHaveLength(1);
  });

  describe("lifecycle (#966)", () => {
    const REOPEN = "/api/me/live-activities/dismissals/reopen";
    const SESSIONS = "/api/me/live-activities/sessions";

    async function signedIn(read: () => MyLiveActivities) {
      const loaded = load();
      loaded.apiFetch.mockImplementation(async (path: string) =>
        path === READ ? read() : undefined,
      );
      await loaded.sync.registerLiveActivityDevice("en");
      return loaded;
    }

    it("brings back a swiped-away activity when the app is opened, not on other syncs", async () => {
      const { sync, apiFetch, surfaces } = await signedIn(() => response(queueProps()));
      await sync.reconcileLiveActivities();
      expect(surfaces).toHaveLength(1);

      // Swiped away: an event-driven sync keeps it away and reports it.
      surfaces.splice(0, 1);
      await sync.reconcileLiveActivities();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(surfaces).toHaveLength(0);
      expect(callsTo(apiFetch, SESSIONS, "DELETE")).toHaveLength(1);
      await sync.reconcileLiveActivities();
      expect(surfaces).toHaveLength(0);

      // App opened: the API releases the dismissal before the read, and it comes back.
      await sync.reconcileLiveActivities({ reopenDismissed: true });
      const order = apiFetch.mock.calls.map(([path]) => path);
      expect(order.lastIndexOf(REOPEN)).toBeLessThan(order.lastIndexOf(READ));
      expect(JSON.parse(callsTo(apiFetch, REOPEN, "POST")[0]![1].body)).toEqual({
        deviceId: "device-1",
      });
      expect(surfaces).toHaveLength(1);
      expect(callsTo(apiFetch, SESSIONS, "DELETE")).toHaveLength(1);
    });

    it("keeps dismissals when the API could not release them", async () => {
      const { sync, apiFetch, surfaces } = await signedIn(() => response(queueProps()));
      await sync.reconcileLiveActivities();
      surfaces.splice(0, 1);
      await sync.reconcileLiveActivities();

      apiFetch.mockImplementation(async (path: string) => {
        if (path === REOPEN) throw new Error("offline");
        return path === READ ? response(queueProps()) : undefined;
      });
      await sync.reconcileLiveActivities({ reopenDismissed: true });
      expect(surfaces).toHaveLength(0);
    });

    it("ends local activities the read model no longer lists", async () => {
      let queue: QueueLiveProps | null = queueProps();
      const { sync, surfaces } = await signedIn(() => response(queue));
      await sync.reconcileLiveActivities();
      expect(surfaces).toHaveLength(1);

      // The queue was deleted: the server lists nothing.
      queue = null;
      await expect(sync.reconcileLiveActivities()).resolves.toEqual([]);
      expect(surfaces).toHaveLength(0);
    });

    it("registers a local start at once, before iOS has its token", async () => {
      const { sync, apiFetch } = await signedIn(() => response(queueProps()));
      await sync.reconcileLiveActivities();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const puts = callsTo(apiFetch, SESSIONS, "PUT");
      expect(puts).toHaveLength(1);
      expect(JSON.parse(puts[0]![1].body)).toEqual({
        deviceId: "device-1",
        kind: "queue",
        subject: "judging",
      });

      // Once is enough until the token arrives.
      await sync.reconcileLiveActivities();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(callsTo(apiFetch, SESSIONS, "PUT")).toHaveLength(1);
    });
  });
});
