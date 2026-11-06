import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const post = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  api: { post: (...args: unknown[]) => post(...args) },
}));
vi.mock("@/lib/i18n", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ApiError } from "@/lib/api";
import { useVerificationResend } from "./use-verification-resend";

describe("useVerificationResend", () => {
  let root: Root;
  let state: ReturnType<typeof useVerificationResend>;

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    post.mockReset();
    root = createRoot(document.createElement("div"));
    function Probe() {
      state = useVerificationResend("a@b.co");
      return null;
    }
    act(() => root.render(<Probe />));
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.restoreAllMocks();
  });

  it("exposes a generic error when the resend fails, and clears it on retry", async () => {
    post.mockRejectedValueOnce(new ApiError(500, "SERVER", "boom"));
    await act(async () => state.resend());
    expect(state.error).toBe("couldNotSendVerificationEmail");

    post.mockResolvedValueOnce({});
    await act(async () => state.resend());
    expect(state.error).toBeNull();
    expect(state.cooldown).toBe(60);
  });

  it("maps INVALID_EMAIL to the valid-email copy", async () => {
    post.mockRejectedValueOnce(new ApiError(400, "invalid_email", "bad"));
    await act(async () => state.resend());
    expect(state.error).toBe("validEmail");
  });

  it("starts the server-provided cooldown on 429", async () => {
    post.mockRejectedValueOnce(new ApiError(429, "TOO_MANY_REQUESTS", "slow", undefined, 30));
    await act(async () => state.resend());
    expect(state.cooldown).toBe(30);
    expect(state.error).toBe("couldNotSendVerificationEmail");
  });
});
