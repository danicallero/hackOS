jest.mock("./auth-client", () => ({
  authClient: { $fetch: jest.fn(), getCookie: jest.fn(() => "session=current") },
}));

jest.mock("./env", () => ({
  API_URL: "https://api.hackudc.com/",
}));

import { type ApiError, apiFetch } from "./api";
import { authClient } from "./auth-client";
import { resetViewedEdition, selectViewedEdition } from "./edition";

const mockFetch = authClient.$fetch as jest.Mock;

describe("apiFetch", () => {
  beforeEach(() => mockFetch.mockReset());
  afterEach(() => resetViewedEdition());

  it("targets application routes at the API origin, outside Better Auth's mount", async () => {
    mockFetch.mockResolvedValue({ data: { status: "ok" }, error: null });

    await expect(apiFetch("/api/public/activities")).resolves.toEqual({ status: "ok" });
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.hackudc.com/api/public/activities",
      expect.objectContaining({
        method: undefined,
        retry: expect.objectContaining({ type: "exponential", attempts: 2 }),
      }),
    );
  });

  it("preserves mutation options", async () => {
    mockFetch.mockResolvedValue({ data: { saved: true }, error: null });
    const init = {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    } as const;

    await apiFetch("/api/me/notification-preferences", init);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.hackudc.com/api/me/notification-preferences",
      expect.objectContaining({
        ...init,
        headers: expect.objectContaining({
          "content-type": "application/json",
          "idempotency-key": expect.any(String),
        }),
        retry: undefined,
      }),
    );
  });

  it("overrides the Expo plugin cookie at request time for a bound session", async () => {
    mockFetch.mockResolvedValue({ data: { ok: true }, error: null });

    await apiFetch("/api/scanner/snapshot", { sessionCookie: "session=staff-a" });

    const options = mockFetch.mock.calls[0][1] as {
      onRequest: (context: { headers: Headers }) => void;
    };
    const headers = new Headers({ cookie: "session=staff-b" });
    options.onRequest({ headers });

    expect(headers.get("cookie")).toBe("session=staff-a");
  });

  it("captures the current cookie for an ordinary request", async () => {
    mockFetch.mockResolvedValue({ data: { ok: true }, error: null });

    await apiFetch("/api/me/ticket");

    const options = mockFetch.mock.calls[0][1] as {
      onRequest: (context: { headers: Headers }) => void;
    };
    const headers = new Headers({ cookie: "session=staff-b" });
    options.onRequest({ headers });

    expect(headers.get("cookie")).toBe("session=current");
  });

  it("forwards abort signals to the authenticated transport", async () => {
    mockFetch.mockResolvedValue({ data: { ok: true }, error: null });
    const controller = new AbortController();

    await apiFetch("/api/me", { signal: controller.signal });

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.hackudc.com/api/me",
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it("rejects URLs that could send the restored session to another origin", async () => {
    await expect(apiFetch("https://attacker.invalid/api/me")).rejects.toBeInstanceOf(TypeError);
    await expect(apiFetch("//attacker.invalid/api/me")).rejects.toBeInstanceOf(TypeError);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("retains structured API failures", async () => {
    mockFetch.mockResolvedValue({
      data: null,
      error: { status: 503, error: { code: "unavailable", message: "Try later" } },
    });

    await expect(apiFetch("/api/me")).rejects.toEqual(
      expect.objectContaining<ApiError>({
        name: "ApiError",
        status: 503,
        code: "unavailable",
        message: "Try later",
      }),
    );
  });

  it("does not delay the authoritative profile read with deployment retries", async () => {
    mockFetch.mockResolvedValue({ data: { id: 1 }, error: null });

    await apiFetch("/api/me");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.hackudc.com/api/me",
      expect.objectContaining({ retry: undefined }),
    );
  });

  it("sends X-Edition only for a non-current selection", async () => {
    mockFetch.mockResolvedValue({ data: {}, error: null });

    await apiFetch("/api/me");
    expect(mockFetch.mock.calls[0]![1].headers["x-edition"]).toBeUndefined();

    selectViewedEdition("hackudc-2025");
    await apiFetch("/api/me");
    expect(mockFetch.mock.calls[1]![1].headers["x-edition"]).toBe("hackudc-2025");

    resetViewedEdition();
    await apiFetch("/api/me");
    expect(mockFetch.mock.calls[2]![1].headers["x-edition"]).toBeUndefined();
  });

  it("omits X-Edition for current-edition requests such as scanner sync", async () => {
    mockFetch.mockResolvedValue({ data: {}, error: null });
    selectViewedEdition("hackudc-2025");

    await apiFetch("/api/scanner/snapshot", { currentEdition: true });

    const call = mockFetch.mock.calls[0]![1];
    expect(call.headers["x-edition"]).toBeUndefined();
    expect(call).not.toHaveProperty("currentEdition");
  });
});
