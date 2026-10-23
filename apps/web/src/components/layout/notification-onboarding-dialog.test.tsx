import userEvent from "@testing-library/user-event";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const session = vi.hoisted(() => ({
  me: null as unknown,
  refresh: vi.fn().mockResolvedValue(undefined),
}));
const notificationsApi = vi.hoisted(() => ({
  getPreferences: vi.fn(),
  completeOnboarding: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/lib/session", () => ({ useSessionContext: () => session }));
vi.mock("@/lib/notifications", () => ({ notificationsApi }));
vi.mock("@/lib/i18n", () => ({
  useLocale: () => ({ language: "en", t: (key: string) => key }),
}));
vi.mock("@/lib/meal-plan", () => ({ isProfileTasksDismissed: () => false }));
vi.mock("@/components/common/modal", () => ({
  Modal: ({
    title,
    footer,
    children,
  }: {
    title: string;
    footer: React.ReactNode;
    children: React.ReactNode;
  }) => (
    <div role="dialog" aria-label={title}>
      {children}
      {footer}
    </div>
  ),
}));

import { NotificationOnboardingDialog } from "./notification-onboarding-dialog";

const prefs = (hasPushDevice: boolean) => ({
  channels: ["in_app", "email", "push"],
  mandatoryCategories: ["queue"],
  emailOptInCategories: ["queue", "schedule", "challenge"],
  hasPushDevice,
  onboardingRequired: true,
  overrides: [],
});

let container: HTMLDivElement;
let root: Root;

async function mount() {
  await act(async () => {
    root.render(<NotificationOnboardingDialog />);
  });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  session.me = { id: 7, notificationOnboardingRequired: true, pendingProfileTasks: [] };
  vi.clearAllMocks();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("NotificationOnboardingDialog", () => {
  it("stays hidden once onboarding is done", async () => {
    session.me = { id: 7, notificationOnboardingRequired: false, pendingProfileTasks: [] };
    await mount();
    expect(container.querySelector("[role=dialog]")).toBeNull();
    expect(notificationsApi.getPreferences).not.toHaveBeenCalled();
  });

  it("with a mobile device starts with email off and stores only what the person turns on", async () => {
    notificationsApi.getPreferences.mockResolvedValue(prefs(true));
    await mount();
    const switches = [...container.querySelectorAll<HTMLButtonElement>("[role=switch]")];
    expect(switches.map((s) => s.getAttribute("aria-checked"))).toEqual([
      "false",
      "false",
      "false",
    ]);

    await act(async () => userEvent.click(switches[1] as HTMLElement));
    await act(async () =>
      userEvent.click([...container.querySelectorAll("button")].at(-1) as HTMLElement),
    );

    expect(notificationsApi.completeOnboarding).toHaveBeenCalledWith([
      { category: "schedule", channel: "email", enabled: true },
    ]);
    expect(session.refresh).toHaveBeenCalled();
  });

  it("without a mobile device shows email on, locked for queue, and stores nothing by default", async () => {
    notificationsApi.getPreferences.mockResolvedValue(prefs(false));
    await mount();
    const switches = [...container.querySelectorAll<HTMLButtonElement>("[role=switch]")];
    expect(switches.map((s) => s.getAttribute("aria-checked"))).toEqual(["true", "true", "true"]);
    expect(switches[0]?.disabled).toBe(true);

    await act(async () =>
      userEvent.click([...container.querySelectorAll("button")].at(-1) as HTMLElement),
    );
    expect(notificationsApi.completeOnboarding).toHaveBeenCalledWith([]);
  });
});
