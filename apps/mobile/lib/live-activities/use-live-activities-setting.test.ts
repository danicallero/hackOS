import { act, renderHook, waitFor } from "@testing-library/react-native";

jest.mock("./host", () => ({ liveActivityHost: { platform: "ios", supported: () => true } }));
jest.mock("./sync", () => ({
  liveActivitiesEnabled: jest.fn(),
  setLiveActivitiesEnabled: jest.fn(),
}));

import { liveActivitiesEnabled, setLiveActivitiesEnabled } from "./sync";
import { useLiveActivitiesSetting } from "./use-live-activities-setting";

beforeEach(() => jest.resetAllMocks());

it("makes a failed device preference read recoverable", async () => {
  jest.mocked(liveActivitiesEnabled).mockRejectedValueOnce(new Error("storage failed"));
  const { result } = await renderHook(() => useLiveActivitiesSetting());
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.error?.message).toBe("storage failed");
  jest.mocked(liveActivitiesEnabled).mockResolvedValueOnce(false);
  await act(async () => {
    result.current.retry();
  });
  await waitFor(() => expect(result.current.available).toBe(true));
  expect(result.current.error).toBeNull();
  expect(result.current.enabled).toBe(false);
});

it("retains the local choice and retries failed device registration", async () => {
  jest.mocked(liveActivitiesEnabled).mockResolvedValueOnce(true);
  const { result } = await renderHook(() => useLiveActivitiesSetting());
  await waitFor(() => expect(result.current.available).toBe(true));
  jest.mocked(setLiveActivitiesEnabled).mockRejectedValueOnce(new Error("offline"));
  await act(async () => {
    await result.current.toggle(false);
  });
  expect(result.current.enabled).toBe(false);
  expect(result.current.error?.message).toBe("offline");
  jest.mocked(setLiveActivitiesEnabled).mockResolvedValueOnce(undefined);
  await act(async () => {
    result.current.retry();
  });
  await waitFor(() => expect(result.current.error).toBeNull());
  expect(setLiveActivitiesEnabled).toHaveBeenLastCalledWith(false);
});
