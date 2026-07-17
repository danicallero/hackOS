// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { loadOfflineQueue, type OfflineScan, saveOfflineQueue } from "./offline-queue";

const saved: OfflineScan = {
  clientScanId: "device-operation-1",
  activityId: 7,
  activityName: "Dinner",
  badgeId: "BADGE-7",
  allowRepeat: false,
  scannedAt: "2026-07-17T20:00:00.000Z",
  status: "pending",
  failureKind: "offline",
  error: "Network unavailable",
};

describe("web scanner restart persistence", () => {
  const values = new Map<string, string>();
  beforeEach(() => {
    values.clear();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    });
  });

  it("restores locally saved operations with their retry state", () => {
    saveOfflineQueue([saved]);
    expect(loadOfflineQueue()).toEqual([saved]);
  });

  it("fails safely when stored queue data is corrupt", () => {
    window.localStorage.setItem("hackos:logistics:meal-scans", "not-json");
    expect(loadOfflineQueue()).toEqual([]);
  });
});
