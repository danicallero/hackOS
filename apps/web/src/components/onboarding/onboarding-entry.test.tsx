import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  replace: vi.fn(),
  path: "/event",
  me: { id: 7, hasEventAccess: true, emailVerified: true } as Record<string, unknown> | null,
}));
vi.mock("next/navigation", () => ({
  usePathname: () => mocks.path,
  useRouter: () => ({ replace: mocks.replace }),
}));
vi.mock("@/lib/session", () => ({ useSessionContext: () => ({ me: mocks.me }) }));
vi.mock("@/lib/onboarding", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/onboarding")>()),
  readOnboarding: mocks.read,
}));

import { OnboardingEntry } from "@/components/onboarding/onboarding-entry";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const pending = { eventKey: "k", revision: 1, steps: [{ step: "profile", status: "pending" }] };
let container: HTMLDivElement;
let root: Root;

const mount = async () => {
  await act(async () => root.render(<OnboardingEntry>app</OnboardingEntry>));
  await act(async () => undefined);
};

beforeEach(() => {
  mocks.read.mockReset();
  mocks.replace.mockReset();
  mocks.path = "/event";
  mocks.me = { id: 7, hasEventAccess: true, emailVerified: true };
  window.sessionStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("OnboardingEntry never gates the app", () => {
  it("always renders its children, even while steps are pending", async () => {
    mocks.read.mockResolvedValue(pending);
    await mount();
    expect(container.textContent).toBe("app");
  });

  it("offers the journey when steps are pending", async () => {
    mocks.read.mockResolvedValue(pending);
    await mount();
    expect(mocks.replace).toHaveBeenCalledWith("/onboarding?next=%2Fevent");
  });

  it("offers on whatever page the person lands on, carrying it as `next` for Later", async () => {
    mocks.read.mockResolvedValue(pending);
    mocks.path = "/schedule";
    await mount();
    expect(mocks.replace).toHaveBeenCalledWith("/onboarding?next=%2Fschedule");
  });

  it("does not redirect from the journey itself, nothing pending, an unverified email or no event access", async () => {
    mocks.read.mockResolvedValue(pending);
    mocks.path = "/onboarding";
    await mount();
    mocks.path = "/event";
    mocks.me = { id: 7, hasEventAccess: true, emailVerified: false };
    await mount();
    mocks.me = { id: 7, hasEventAccess: false, emailVerified: true };
    await mount();
    mocks.me = { id: 7, hasEventAccess: true, emailVerified: true };
    mocks.read.mockResolvedValue({ ...pending, steps: [{ step: "profile", status: "completed" }] });
    await mount();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("reads once per session even when nothing is pending", async () => {
    mocks.read.mockResolvedValue({ ...pending, steps: [{ step: "profile", status: "completed" }] });
    await mount();
    await mount();
    expect(mocks.read).toHaveBeenCalledTimes(1);
  });

  it("offers once per browser session", async () => {
    mocks.read.mockResolvedValue(pending);
    window.sessionStorage.setItem("hackos.onboardingOffered.7", "1");
    await mount();
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("ignores a failed read", async () => {
    mocks.read.mockRejectedValue(new Error("down"));
    await mount();
    expect(container.textContent).toBe("app");
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});
