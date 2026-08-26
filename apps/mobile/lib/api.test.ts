jest.mock("./auth-client", () => ({
  authClient: { $fetch: jest.fn() },
}));

jest.mock("./env", () => ({
  API_URL: "https://api.hackudc.com/",
}));

import { type ApiError, apiFetch } from "./api";
import { authClient } from "./auth-client";

const mockFetch = authClient.$fetch as jest.Mock;

describe("apiFetch", () => {
  beforeEach(() => mockFetch.mockReset());

  it("targets application routes at the API origin, outside Better Auth's mount", async () => {
    mockFetch.mockResolvedValue({ data: { status: "ok" }, error: null });

    await expect(apiFetch("/api/public/activities")).resolves.toEqual({ status: "ok" });
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.hackudc.com/api/public/activities",
      expect.objectContaining({
        method: undefined,
        retry: expect.objectContaining({ type: "exponential", attempts: 4 }),
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
      expect.objectContaining({ ...init, retry: undefined }),
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
});
