import userEvent from "@testing-library/user-event";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

window.matchMedia = ((query: string) => ({
  matches: false,
  media: query,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
})) as unknown as typeof window.matchMedia;

vi.mock("@/lib/i18n", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
vi.mock("@/components/layout/auth-guard", () => ({
  AuthGuard: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/components/layout/app-sidebar", () => ({
  AppSidebar: () => (
    <nav aria-label="navigationPrimary">
      <a href="/event">Home</a>
    </nav>
  ),
  NotificationSidebarTrigger: () => <button type="button">toggleSidebar</button>,
}));
vi.mock("@/components/layout/verification-banner", () => ({ VerificationBanner: () => null }));
vi.mock("@/components/layout/profile-tasks-dialog", () => ({ ProfileTasksDialog: () => null }));
vi.mock("@/components/layout/notification-onboarding-dialog", () => ({
  NotificationOnboardingDialog: () => null,
}));

import { AppShell } from "./app-shell";

describe("AppShell landmarks (#1172, #1173)", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders exactly one top-level main#main-content around the page", () => {
    act(() =>
      root.render(
        <AppShell>
          <h1>Users</h1>
        </AppShell>,
      ),
    );

    const mains = container.querySelectorAll("main");
    expect(mains).toHaveLength(1);
    expect(mains[0].id).toBe("main-content");
    expect(mains[0].tabIndex).toBe(-1);
    expect(mains[0].parentElement?.closest("main, nav, aside, header, footer, section")).toBeNull();
    expect(mains[0].querySelector("h1")?.textContent).toBe("Users");
  });

  it("makes the skip link the first tab stop and moves focus to main", async () => {
    const user = userEvent.setup();
    act(() =>
      root.render(
        <AppShell>
          <button type="button">Page action</button>
        </AppShell>,
      ),
    );

    await user.tab();
    const skip = document.activeElement as HTMLAnchorElement;
    expect(skip.textContent).toBe("skipToContent");
    expect(skip.getAttribute("href")).toBe("#main-content");

    await user.keyboard("{Enter}");
    expect(document.activeElement).toBe(container.querySelector("main"));
  });
});
