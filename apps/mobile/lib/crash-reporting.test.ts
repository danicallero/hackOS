import type { ErrorEvent } from "@sentry/react-native";

const mockInit = jest.fn();
const mockSetTag = jest.fn();
jest.mock("@sentry/react-native", () => ({
  init: (...args: unknown[]) => mockInit(...args),
  captureException: jest.fn(),
  getGlobalScope: () => ({ setTag: mockSetTag }),
}));
jest.mock("./env", () => ({
  API_URL: "https://api.hackudc.com",
  PRODUCTION_API_URL: "https://api.hackudc.com",
  onApiUrlChange: jest.fn(),
}));

const { initCrashReporting, scrubEvent } =
  require("./crash-reporting") as typeof import("./crash-reporting");

describe("crash reporting", () => {
  const dev = (globalThis as { __DEV__?: boolean }).__DEV__;
  afterEach(() => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = dev;
    mockInit.mockReset();
  });

  it("stays off without a DSN and in development", () => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;
    expect(initCrashReporting(undefined)).toBe(false);
    (globalThis as { __DEV__?: boolean }).__DEV__ = true;
    expect(initCrashReporting("https://key@sentry.test/1")).toBe(false);
    expect(mockInit).not.toHaveBeenCalled();
  });

  it("reports errors only, without personal data, tagged with the API mode", () => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;
    expect(initCrashReporting("https://key@sentry.test/1")).toBe(true);
    expect(mockInit).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: "https://key@sentry.test/1",
        sendDefaultPii: false,
        tracesSampleRate: 0,
        beforeSend: scrubEvent,
      }),
    );
    const { beforeBreadcrumb } = mockInit.mock.calls[0][0];
    expect(beforeBreadcrumb({ category: "console", message: "ada@example.com" })).toBeNull();
    expect(beforeBreadcrumb({ category: "navigation" })).toEqual({ category: "navigation" });
    expect(mockSetTag).toHaveBeenCalledWith("api", "production");
  });

  it("strips the user, request headers, cookies, bodies and query strings", () => {
    const event = scrubEvent({
      type: undefined,
      user: { id: "7", email: "ada@example.com" },
      request: {
        url: "https://api.hackudc.com/api/users/7/photo?v=abc",
        headers: { Cookie: "session=abc" },
        cookies: { session: "abc" },
        data: { email: "ada@example.com" },
        query_string: "v=abc",
      },
      breadcrumbs: [{ category: "fetch", data: { url: "https://api.hackudc.com/api/me?x=1#y" } }],
    } as ErrorEvent);
    expect(event.user).toBeUndefined();
    expect(event.request).toEqual({ url: "https://api.hackudc.com/api/users/7/photo" });
    expect(event.breadcrumbs?.[0].data?.url).toBe("https://api.hackudc.com/api/me");
  });
});
