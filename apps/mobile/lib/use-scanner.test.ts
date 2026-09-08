import { act, renderHook } from "@testing-library/react-native";
import { AppState } from "react-native";

jest.mock("./api", () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
  getClockSkewMs: () => null,
}));

let mockOwnerUserId = 1;
jest.mock("./me-context", () => ({
  useMeContext: () => ({ me: { id: mockOwnerUserId } }),
}));

jest.mock("./scanner-db", () => ({
  deleteScan: jest.fn().mockResolvedValue(undefined),
  getScannerMeta: jest.fn().mockResolvedValue({ lastSync: null }),
  pendingScans: jest.fn().mockResolvedValue([]),
  retryFailedScans: jest.fn().mockResolvedValue(undefined),
  retryScan: jest.fn().mockResolvedValue(undefined),
  syncErrorHistory: jest.fn().mockResolvedValue([]),
}));

jest.mock("./scanner-sync", () => ({
  synchronizeScanner: jest.fn().mockResolvedValue({
    snapshot: {
      generatedAt: "2026-01-01T00:00:00.000Z",
      people: [],
      activities: [],
      activityStates: [],
    },
    localError: null,
  }),
}));

import { synchronizeScanner } from "./scanner-sync";
import { useScannerSync } from "./use-scanner";

const mockSynchronizeScanner = synchronizeScanner as jest.Mock;

// Real AppState is backed by a native module the test environment can't
// drive directly, so intercept just `addEventListener` — same approach as
// use-me.test.ts's "inactive -> active" simulation.
let appStateListeners: Set<(state: string) => void>;

function emitAppState(nextState: string) {
  (AppState as { currentState: string }).currentState = nextState;
  for (const listener of appStateListeners) listener(nextState);
}

describe("useScannerSync (shared store across mounted screens)", () => {
  beforeAll(() => {
    jest.useFakeTimers();
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  beforeEach(() => {
    // A fresh operator id per test avoids any cross-test bleed through the
    // module-level store map in lib/use-scanner.ts.
    mockOwnerUserId += 1;
    mockSynchronizeScanner.mockClear();
    appStateListeners = new Set();
    jest.spyOn(AppState, "addEventListener").mockImplementation((_event, cb) => {
      const listener = cb as (state: string) => void;
      appStateListeners.add(listener);
      return { remove: () => appStateListeners.delete(listener) };
    });
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.restoreAllMocks();
  });

  it("runs a single sync per tick for the same operator, not one per mounted screen", async () => {
    // Simulates two screens that both use the scanner (e.g. the general
    // scanner and the people directory) mounted at the same time for the
    // same signed-in operator.
    const first = await renderHook(() => useScannerSync());
    const second = await renderHook(() => useScannerSync());

    // Only the shared store's own startup sync should have fired — not one
    // per hook instance.
    expect(mockSynchronizeScanner).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(15_000);
      await Promise.resolve();
    });
    // A single 15s tick from the shared timer, still not one per screen.
    expect(mockSynchronizeScanner).toHaveBeenCalledTimes(2);

    await first.unmount();
    await second.unmount();
  });

  it("keeps syncing while at least one screen is still mounted, and stops once all unmount", async () => {
    const first = await renderHook(() => useScannerSync());
    const second = await renderHook(() => useScannerSync());
    expect(mockSynchronizeScanner).toHaveBeenCalledTimes(1);

    await first.unmount();

    await act(async () => {
      jest.advanceTimersByTime(15_000);
      await Promise.resolve();
    });
    // The second screen is still mounted, so the shared timer must still fire.
    expect(mockSynchronizeScanner).toHaveBeenCalledTimes(2);

    await second.unmount();
    mockSynchronizeScanner.mockClear();

    await act(async () => {
      jest.advanceTimersByTime(30_000);
      await Promise.resolve();
    });
    // Nothing left observing this operator — the timer must have stopped.
    expect(mockSynchronizeScanner).not.toHaveBeenCalled();
  });

  it("triggers exactly one sync on foreground return, regardless of how many screens are mounted", async () => {
    const first = await renderHook(() => useScannerSync());
    const second = await renderHook(() => useScannerSync());
    mockSynchronizeScanner.mockClear();

    await act(async () => {
      emitAppState("inactive");
      emitAppState("active");
      await Promise.resolve();
    });
    // Only one `AppState` listener should be registered for the shared
    // store (not one per mounted screen), so foreground return fires the
    // sync exactly once.
    expect(mockSynchronizeScanner).toHaveBeenCalledTimes(1);

    await first.unmount();
    await second.unmount();
  });
});
