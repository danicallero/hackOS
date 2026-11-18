import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const calls = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, api: { get: calls.get, post: calls.post } };
});
vi.mock("@/lib/auth-client", () => ({
  authClient: { getSession: async () => ({ data: { session: { token: "here" } } }) },
}));
vi.mock("@/lib/i18n", () => ({
  useLocale: () => ({
    t: (key: string, vars?: Record<string, string>) =>
      vars ? `${key}: ${Object.values(vars).join(" ")}` : key,
    language: "en",
  }),
}));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { ApiError } from "@/lib/api";
import { ActiveDevices } from "./active-devices";

const SESSIONS = [
  { token: "here", userAgent: null, updatedAt: "2026-11-18T10:00:00Z" },
  { token: "phone", userAgent: null, updatedAt: "2026-11-17T10:00:00Z" },
];

let root: Root;
let container: HTMLDivElement;

async function render() {
  await act(async () => {
    root.render(<ActiveDevices />);
  });
}

function click(element: Element | null | undefined) {
  if (!element) throw new Error("missing element");
  return act(async () => {
    (element as HTMLElement).click();
  });
}

const byText = (text: string) =>
  [...document.body.querySelectorAll("button")].find((b) => b.textContent === text);

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  calls.get.mockReset();
  calls.post.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

describe("Active devices (H28)", () => {
  it("states why the list failed and offers no retry when retrying cannot help", async () => {
    calls.get.mockRejectedValue(new ApiError(403, "SESSION_NOT_FRESH", "Session is not fresh"));
    await render();
    expect(document.body.textContent).toContain("couldNotLoadDevicesBecause: Session is not fresh");
    expect(byText("retry")).toBeUndefined();
  });

  it("offers a retry when the server failed", async () => {
    calls.get.mockRejectedValue(new ApiError(503, "unknown", "Unavailable"));
    await render();
    expect(byText("retry")).toBeDefined();
  });

  it("asks a stale session for the password, then signs the device out", async () => {
    calls.get.mockResolvedValue(SESSIONS);
    calls.post
      .mockRejectedValueOnce(
        new ApiError(400, "bad_request", "", { code: "session_revoke_reauthentication_required" }),
      )
      .mockResolvedValueOnce({ status: true });
    await render();
    await click(document.body.querySelector('button[aria-label="signOutDevice"]'));
    expect(calls.post).toHaveBeenLastCalledWith("/api/auth/revoke-session", { token: "phone" });

    const input = document.body.querySelector<HTMLInputElement>("#revoke-session-password");
    expect(input).not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "secret-pass");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(byText("signOut"));
    expect(calls.post).toHaveBeenLastCalledWith("/api/auth/revoke-session", {
      token: "phone",
      password: "secret-pass",
    });
  });
});
