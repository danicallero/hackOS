jest.mock("./api", () => ({ apiFetch: jest.fn() }));

import { apiFetch } from "./api";
import { scannerFetch } from "./scanner-request";

it("aborts and rejects a stalled scanner request even when transport ignores abort (H22–H26)", async () => {
  jest.useFakeTimers();
  jest.mocked(apiFetch).mockImplementation(() => new Promise(() => {}));
  try {
    const request = scannerFetch("/api/scanner/snapshot");
    const rejected = expect(request).rejects.toThrow("Scanner request timed out");
    await jest.advanceTimersByTimeAsync(5_000);
    await rejected;
    expect(jest.mocked(apiFetch).mock.calls[0]![1]!.signal!.aborted).toBe(true);
  } finally {
    jest.useRealTimers();
  }
});
