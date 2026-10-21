jest.mock("./api", () => ({
  ApiError: class MockApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

import { ApiError } from "./api";
import {
  enqueuePendingScan,
  flushPendingScans,
  isOfflineError,
  readPendingScans,
} from "./diary-pending";

const mockStore = new Map<string, string>();
jest.mock("expo-sqlite/kv-store", () => ({
  __esModule: true,
  default: {
    getItem: async (key: string) => mockStore.get(key) ?? null,
    setItem: async (key: string, value: string) => void mockStore.set(key, value),
    removeItem: async (key: string) => void mockStore.delete(key),
  },
}));

beforeEach(() => mockStore.clear());

describe("diary pending scans (H22)", () => {
  it("queues a code once", async () => {
    await enqueuePendingScan(1, "A");
    await enqueuePendingScan(1, "A");
    await enqueuePendingScan(1, "B");
    expect((await readPendingScans(1)).map((scan) => scan.code)).toEqual(["A", "B"]);
    expect(await readPendingScans(2)).toEqual([]);
  });

  it("sends in order, drops refused codes and stops at the first transport failure", async () => {
    for (const code of ["A", "B", "C", "D"]) await enqueuePendingScan(1, code);
    const submit = jest.fn(async (code: string) => {
      if (code === "B") throw new ApiError("hidden", 403);
      if (code === "C") throw new ApiError("offline", 0);
    });
    const result = await flushPendingScans(1, submit);
    expect(submit.mock.calls.map(([code]) => code)).toEqual(["A", "B", "C"]);
    expect(result.sent).toBe(1);
    expect(result.remaining.map((scan) => scan.code)).toEqual(["C", "D"]);
    expect((await readPendingScans(1)).map((scan) => scan.code)).toEqual(["C", "D"]);
  });

  it("tells a transport failure from a refusal", () => {
    expect(isOfflineError(new ApiError("x", 0))).toBe(true);
    expect(isOfflineError(new TypeError("Network request failed"))).toBe(true);
    expect(isOfflineError(new ApiError("x", 403))).toBe(false);
  });
});
