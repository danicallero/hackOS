/**
 * #966 (H38, H25, H59, H19, H22): per-kind Live Activity toggles and kind
 * order in Notifications — load only while active, optimistic changes,
 * re-sync this device, roll back on failure.
 */
import { act, renderHook, waitFor } from "@testing-library/react-native";

jest.mock("@/lib/api", () => ({ apiFetch: jest.fn() }));
jest.mock("./sync", () => ({ reconcileLiveActivities: jest.fn(async () => []) }));

import { apiFetch } from "@/lib/api";
import { reconcileLiveActivities } from "./sync";
import { useLiveActivityKinds } from "./use-live-activity-kinds";

const mockApiFetch = apiFetch as jest.Mock;
const mockReconcile = reconcileLiveActivities as jest.Mock;

const LIST = {
  kinds: [
    { kind: "activity", enabled: true },
    { kind: "queue", enabled: true },
  ],
  customOrder: false,
};

beforeEach(() => {
  mockApiFetch.mockReset();
  mockReconcile.mockClear();
});

describe("useLiveActivityKinds", () => {
  it("loads nothing and shows no kinds while inactive (master switch off)", async () => {
    const { result } = await renderHook(() => useLiveActivityKinds(false));
    await act(async () => undefined);
    expect(mockApiFetch).not.toHaveBeenCalled();
    expect(result.current.kinds).toEqual([]);
  });

  it("turns a kind off optimistically, saves only that kind and re-syncs the device", async () => {
    mockApiFetch.mockResolvedValueOnce(LIST);
    const { result } = await renderHook(() => useLiveActivityKinds(true));
    await waitFor(() => expect(result.current.kinds).toEqual(LIST.kinds));

    let resolvePut!: (value: unknown) => void;
    mockApiFetch.mockReturnValueOnce(new Promise((resolve) => (resolvePut = resolve)));
    let pending!: Promise<void>;
    await act(async () => {
      pending = result.current.toggle("activity", false);
    });
    expect(result.current.kinds[0]).toEqual({ kind: "activity", enabled: false });
    expect(result.current.busyKind).toBe("activity");
    expect(mockApiFetch).toHaveBeenLastCalledWith("/api/me/live-activities/preferences", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kinds: [{ kind: "activity", enabled: false }] }),
    });
    expect(mockReconcile).not.toHaveBeenCalled();

    await act(async () => {
      resolvePut({ ...LIST, kinds: [{ kind: "activity", enabled: false }, LIST.kinds[1]] });
      await pending;
    });
    expect(mockReconcile).toHaveBeenCalledTimes(1);
    expect(result.current.busyKind).toBeNull();
  });

  it("rolls the switch back when the save fails", async () => {
    mockApiFetch.mockResolvedValueOnce(LIST);
    const { result } = await renderHook(() => useLiveActivityKinds(true));
    await waitFor(() => expect(result.current.kinds).toEqual(LIST.kinds));

    mockApiFetch.mockRejectedValueOnce(new Error("offline"));
    await act(async () => {
      await result.current.toggle("queue", false);
    });
    expect(result.current.kinds[1]).toEqual({ kind: "queue", enabled: true });
    expect(mockReconcile).not.toHaveBeenCalled();
    expect(result.current.busyKind).toBeNull();
  });

  it("reorders optimistically, sends the whole order and re-syncs the device", async () => {
    mockApiFetch.mockResolvedValueOnce(LIST);
    const { result } = await renderHook(() => useLiveActivityKinds(true));
    await waitFor(() => expect(result.current.kinds).toEqual(LIST.kinds));

    const reordered = { kinds: [LIST.kinds[1], LIST.kinds[0]], customOrder: true };
    let resolvePut!: (value: unknown) => void;
    mockApiFetch.mockReturnValueOnce(new Promise((resolve) => (resolvePut = resolve)));
    let pending!: Promise<void>;
    await act(async () => {
      pending = result.current.reorder(["queue", "activity"]);
    });
    expect(result.current.kinds).toEqual(reordered.kinds);
    expect(result.current.customOrder).toBe(true);
    expect(result.current.ordering).toBe(true);
    expect(mockApiFetch).toHaveBeenLastCalledWith("/api/me/live-activities/preferences", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ order: ["queue", "activity"] }),
    });

    await act(async () => {
      resolvePut(reordered);
      await pending;
    });
    expect(mockReconcile).toHaveBeenCalledTimes(1);
    expect(result.current.ordering).toBe(false);
  });

  it("restores the previous order when the save fails, and resets with null", async () => {
    const custom = { kinds: [LIST.kinds[1], LIST.kinds[0]], customOrder: true };
    mockApiFetch.mockResolvedValueOnce(custom);
    const { result } = await renderHook(() => useLiveActivityKinds(true));
    await waitFor(() => expect(result.current.customOrder).toBe(true));

    mockApiFetch.mockRejectedValueOnce(new Error("offline"));
    await act(async () => {
      await result.current.reorder(["activity", "queue"]);
    });
    expect(result.current.kinds).toEqual(custom.kinds);
    expect(result.current.ordering).toBe(false);

    mockApiFetch.mockResolvedValueOnce(LIST);
    await act(async () => {
      await result.current.resetOrder();
    });
    expect(mockApiFetch).toHaveBeenLastCalledWith("/api/me/live-activities/preferences", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ order: null }),
    });
    expect(result.current.kinds).toEqual(LIST.kinds);
    expect(result.current.customOrder).toBe(false);
  });
});

it("exposes initial read failure, retries, and retains rows after a later read failure", async () => {
  mockApiFetch.mockRejectedValueOnce(new Error("offline"));
  const { result } = await renderHook(() => useLiveActivityKinds(true));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.ready).toBe(false);
  expect(result.current.error?.message).toBe("offline");
  mockApiFetch.mockResolvedValueOnce(LIST);
  await act(async () => {
    await result.current.load();
  });
  expect(result.current.ready).toBe(true);
  expect(result.current.error).toBeNull();
  mockApiFetch.mockRejectedValueOnce(new Error("unavailable"));
  await act(async () => {
    await result.current.load();
  });
  expect(result.current.kinds).toEqual(LIST.kinds);
  expect(result.current.error?.message).toBe("unavailable");
});

it("exposes failed mutation and retries that exact choice", async () => {
  mockApiFetch.mockResolvedValueOnce(LIST);
  const { result } = await renderHook(() => useLiveActivityKinds(true));
  await waitFor(() => expect(result.current.ready).toBe(true));
  mockApiFetch.mockRejectedValueOnce(new Error("offline"));
  await act(async () => {
    await result.current.toggle("queue", false);
  });
  expect(result.current.actionError?.message).toBe("offline");
  expect(result.current.kinds[1].enabled).toBe(true);
  mockApiFetch.mockResolvedValueOnce({
    ...LIST,
    kinds: [LIST.kinds[0], { kind: "queue", enabled: false }],
  });
  await act(async () => {
    result.current.retry();
  });
  await waitFor(() => expect(result.current.actionError).toBeNull());
  expect(result.current.kinds[1].enabled).toBe(false);
});
