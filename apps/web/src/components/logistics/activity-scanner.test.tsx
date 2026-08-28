import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const mocks = vi.hoisted(() => ({
  clearOfflineQueue: vi.fn(),
  loadOfflineQueue: vi.fn(),
  mealBatch: vi.fn(),
  refetch: vi.fn(),
  session: { me: { id: 1 } as { id: number } | null },
  staleOfflineScanError: vi.fn(() => false),
  updateOfflineQueue: vi.fn(),
  useLiveQuery: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  useSessionContext: () => mocks.session,
}));
vi.mock("@/lib/i18n", () => ({
  useLocale: () => ({ t: (key: string) => key }),
}));
vi.mock("@/hooks/use-event-source", () => ({
  useLiveQuery: mocks.useLiveQuery,
}));
vi.mock("@/lib/logistics", () => ({
  logisticsApi: {
    activityScan: vi.fn(),
    mealBatch: mocks.mealBatch,
    scannableActivities: vi.fn(),
    searchPeople: vi.fn(),
  },
}));
vi.mock("./offline-queue", () => {
  const ReactLib = require("react");
  return {
    OfflineQueue: ({ items }: { items: Array<{ activityName: string }> }) =>
      ReactLib.createElement(
        "div",
        { "data-testid": "offline-queue" },
        items.map((item) =>
          ReactLib.createElement("span", { key: item.activityName }, item.activityName),
        ),
      ),
    clearOfflineQueue: mocks.clearOfflineQueue,
    isStaleOfflineScanError: mocks.staleOfflineScanError,
    loadOfflineQueue: mocks.loadOfflineQueue,
    updateOfflineQueue: mocks.updateOfflineQueue,
  };
});

import { ActivityScannerCard } from "./activity-scanner";

function queued(activityName: string) {
  return {
    clientScanId: activityName,
    activityId: 1,
    activityName,
    badgeId: `badge-${activityName}`,
    allowRepeat: false,
    scannedAt: "2026-01-01T00:00:00.000Z",
    status: "pending" as const,
  };
}

describe("ActivityScannerCard owner fencing", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    mocks.session.me = { id: 1 };
    mocks.loadOfflineQueue.mockReset().mockResolvedValue([]);
    mocks.mealBatch.mockReset();
    mocks.staleOfflineScanError.mockReset().mockReturnValue(false);
    mocks.updateOfflineQueue.mockReset();
    mocks.clearOfflineQueue.mockReset();
    mocks.refetch.mockReset();
    mocks.useLiveQuery.mockReset().mockReturnValue({
      connected: true,
      data: {
        items: [{ activityId: 1, name: "Meal", count: 0, distinctPeople: 0, repeats: 0 }],
      },
      loading: false,
      refetch: mocks.refetch,
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("ignores an account-A queue load that resolves after switching to account B", async () => {
    let resolveA!: (items: ReturnType<typeof queued>[]) => void;
    let resolveB!: (items: ReturnType<typeof queued>[]) => void;
    const pendingA = new Promise<ReturnType<typeof queued>[]>((resolve) => {
      resolveA = resolve;
    });
    const pendingB = new Promise<ReturnType<typeof queued>[]>((resolve) => {
      resolveB = resolve;
    });
    mocks.loadOfflineQueue.mockImplementation((ownerId: number) =>
      ownerId === 1 ? pendingA : pendingB,
    );

    await act(async () => {
      root.render(<ActivityScannerCard category="meal" />);
    });
    mocks.session.me = { id: 2 };
    await act(async () => {
      root.render(<ActivityScannerCard category="meal" />);
    });

    await act(async () => {
      resolveA([queued("account-A")]);
      resolveB([queued("account-B")]);
      await Promise.resolve();
    });

    expect(container.textContent).toContain("account-B");
    expect(container.textContent).not.toContain("account-A");
  });

  it("keeps later scans when an acknowledged scan cannot be removed", async () => {
    const first = queued("first");
    const later = queued("later");
    let current = [first, later];
    let updateCalls = 0;
    mocks.loadOfflineQueue.mockImplementation(() => Promise.resolve(current));
    mocks.updateOfflineQueue.mockImplementation(
      async (_ownerId: number, update: (items: typeof current) => typeof current) => {
        updateCalls += 1;
        const next = update(current);
        if (updateCalls === 2) throw new Error("storage unavailable");
        current = next;
        return next;
      },
    );
    mocks.mealBatch.mockResolvedValue({});

    await act(async () => {
      root.render(<ActivityScannerCard category="meal" />);
      await Promise.resolve();
    });
    const syncButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("syncPending"),
    );
    expect(syncButton).not.toBeUndefined();

    await act(async () => {
      (syncButton as HTMLButtonElement).click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.mealBatch).toHaveBeenCalledTimes(1);
    expect(mocks.clearOfflineQueue).not.toHaveBeenCalled();
    expect(current.map((scan) => scan.clientScanId)).toEqual(["first", "later"]);
    expect(container.textContent).toContain("later");
  });

  it("removes a stale credential without clearing later scans", async () => {
    const stale = queued("stale");
    const later = queued("later");
    let current = [stale, later];
    mocks.loadOfflineQueue.mockImplementation(() => Promise.resolve(current));
    mocks.updateOfflineQueue.mockImplementation(
      async (_ownerId: number, update: (items: typeof current) => typeof current) => {
        current = update(current);
        return current;
      },
    );
    mocks.staleOfflineScanError.mockReturnValue(true);
    mocks.mealBatch.mockRejectedValueOnce({ code: "badge_revoked" }).mockResolvedValue({});

    await act(async () => {
      root.render(<ActivityScannerCard category="meal" />);
      await Promise.resolve();
    });
    const syncButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("syncPending"),
    );
    expect(syncButton).not.toBeUndefined();

    await act(async () => {
      (syncButton as HTMLButtonElement).click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.clearOfflineQueue).not.toHaveBeenCalled();
    expect(current.map((scan) => scan.clientScanId)).toEqual([]);
  });
});
