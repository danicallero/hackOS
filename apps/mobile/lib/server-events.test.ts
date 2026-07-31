jest.mock("react-native", () => ({ Platform: { OS: "ios" } }));
jest.mock("./auth-client", () => ({
  authClient: { getCookie: jest.fn(() => "session=restored") },
}));
jest.mock("./env", () => ({ API_URL: "https://api.hackos.test" }));

import { authClient } from "./auth-client";
import { startQueueEventStream } from "./server-events";

const mockGetCookie = authClient.getCookie as jest.Mock;

describe("operational native event streams", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockGetCookie.mockClear().mockReturnValue("session=restored");
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: jest.fn(),
      writable: true,
    });
  });

  afterEach(() => {
    // Expo exposes fetch through a lazy global accessor. Restoring that
    // accessor lets Jest's environment teardown import Expo Winter fetch after
    // the test has ended, which emits a native-module warning and fails the
    // suite. This Jest file owns its sandbox, so retain the inert mock until
    // that sandbox is discarded instead.
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  it("does not open the operational stream while its capability gate is disabled", () => {
    const stop = startQueueEventStream(false);

    expect(globalThis.fetch).not.toHaveBeenCalled();
    stop();
  });

  it("sends the restored session cookie on the initial connection and reconnect", async () => {
    const read = jest.fn().mockResolvedValue({ done: true, value: undefined });
    (globalThis.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      body: { getReader: () => ({ read }) },
    });

    const stop = startQueueEventStream();
    await Promise.resolve();
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(1_000);

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      "https://api.hackos.test/api/queue/stream",
      expect.objectContaining({
        headers: { accept: "text/event-stream", cookie: "session=restored" },
      }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      "https://api.hackos.test/api/queue/stream",
      expect.objectContaining({
        headers: { accept: "text/event-stream", cookie: "session=restored" },
      }),
    );
    expect(mockGetCookie).toHaveBeenCalledTimes(2);

    stop();
  });
});
