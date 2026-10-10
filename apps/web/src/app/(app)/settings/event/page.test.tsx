import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EventSettingsPage from "./page";

// #932: the section list and `?tab=` deep links replace the vertical rail.

let search = "";
let caps = new Set<string>();
const replace = vi.fn();
const push = vi.fn();

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search),
  useRouter: () => ({ replace, push }),
  usePathname: () => "/settings/event",
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/session", () => ({ useCan: (cap: string) => caps.has(cap) }));
vi.mock("@/lib/i18n", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
vi.mock("./event-config-context", () => ({
  EventConfigProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("./event-tab", () => ({ EventTab: () => <div data-testid="event-form" /> }));
vi.mock("./venue-tab", () => ({
  VenueTab: ({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) => (
    <button type="button" data-testid="venue-form" onClick={() => onDirtyChange(true)} />
  ),
}));
vi.mock("./wallet-tab", () => ({ WalletTab: () => <div data-testid="wallet-form" /> }));
vi.mock("./presence-tab", () => ({ PresenceTab: () => null }));
vi.mock("./invites-tab", () => ({ InvitesTab: () => null }));
vi.mock("./reset-judging-data-tab", () => ({ ResetJudgingDataTab: () => null }));
vi.mock("../../queue/rooms/judging-window-tab", () => ({ JudgingWindowTab: () => null }));

let confirmSpy: ReturnType<typeof vi.spyOn>;
let pushState: ReturnType<typeof vi.spyOn>;
let historyBack: ReturnType<typeof vi.spyOn>;
let container: HTMLDivElement;
let root: Root;

async function render() {
  await act(async () => {
    root.render(<EventSettingsPage />);
  });
}

const links = () => [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  search = "";
  confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
  pushState = vi.spyOn(window.history, "pushState");
  historyBack = vi.spyOn(window.history, "back").mockImplementation(() => {});
  caps = new Set(["event:manage", "wallet:manage"]);
  replace.mockClear();
  push.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
  act(() => root.unmount());
  container.remove();
});

describe("EventSettingsPage", () => {
  it("lists only the sections the caller may manage, as deep links", async () => {
    await render();
    expect(links()).toEqual(["/settings/event?tab=event", "/settings/event?tab=wallet"]);
    expect(container.querySelector("[data-testid]")).toBeNull();
  });

  it("opens a section from its deep link with a back link to the list", async () => {
    search = "tab=wallet";
    await render();
    expect(container.querySelector("[data-testid=wallet-form]")).not.toBeNull();
    expect(links()).toEqual(["/settings/event"]);
  });

  it("shows the list for a section the caller cannot manage, without writing the URL", async () => {
    search = "tab=venue";
    await render();
    expect(container.querySelector("[data-testid=venue-form]")).toBeNull();
    expect(links()).toHaveLength(2);
    expect(replace).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("opens a lone section directly, with no list to go back to", async () => {
    caps = new Set(["venue:manage"]);
    await render();
    expect(container.querySelector("[data-testid=venue-form]")).not.toBeNull();
    expect(links()).toEqual([]);
  });

  it("shows the list for an unmanaged ?tab= even with a single visible section", async () => {
    caps = new Set(["venue:manage"]);
    search = "tab=wallet";
    await render();
    expect(container.querySelector("[data-testid=venue-form]")).toBeNull();
    expect(links()).toEqual(["/settings/event?tab=venue"]);
  });

  describe("unsaved-changes guard", () => {
    beforeEach(() => {
      caps = new Set(["event:manage", "venue:manage"]);
      search = "tab=venue";
    });

    const dirtyVenue = async () => {
      await render();
      await act(async () => {
        container.querySelector<HTMLElement>("[data-testid=venue-form]")?.click();
      });
    };

    // Counts clicks that get past the guard's capture-phase interception.
    function clickBack() {
      let reached = 0;
      const onClick = (e: Event) => {
        reached++;
        e.preventDefault();
      };
      container.addEventListener("click", onClick);
      act(() => container.querySelector<HTMLElement>("a")?.click());
      container.removeEventListener("click", onClick);
      return reached;
    }

    it("confirms before the back link leaves a dirty section", async () => {
      await dirtyVenue();
      expect(clickBack()).toBe(0);
      expect(confirmSpy).toHaveBeenCalledTimes(1);
      confirmSpy.mockReturnValue(true);
      expect(clickBack()).toBe(1);
    });

    it("does not ask while the section is clean, and pushes no history entry", async () => {
      await render();
      expect(clickBack()).toBe(1);
      expect(confirmSpy).not.toHaveBeenCalled();
      expect(pushState).not.toHaveBeenCalled();
    });

    it("keeps edits on browser Back until the user confirms", async () => {
      await dirtyVenue();
      expect(pushState).toHaveBeenCalledTimes(1);
      await render();
      expect(pushState).toHaveBeenCalledTimes(1);

      act(() => window.dispatchEvent(new PopStateEvent("popstate")));
      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(historyBack).not.toHaveBeenCalled();
      expect(pushState).toHaveBeenCalledTimes(2);
      expect(container.querySelector("[data-testid=venue-form]")).not.toBeNull();

      confirmSpy.mockReturnValue(true);
      act(() => window.dispatchEvent(new PopStateEvent("popstate")));
      expect(historyBack).toHaveBeenCalledTimes(1);
    });

    it("clears the flag once the section is left", async () => {
      await dirtyVenue();
      confirmSpy.mockReturnValue(true);
      search = "";
      await render();
      confirmSpy.mockClear();
      act(() => window.dispatchEvent(new PopStateEvent("popstate")));
      expect(confirmSpy).not.toHaveBeenCalled();

      // Reopening the section starts clean.
      search = "tab=venue";
      await render();
      expect(clickBack()).toBe(1);
      expect(confirmSpy).not.toHaveBeenCalled();
    });
  });

  it("gives the back link a back label and no duplicate title", async () => {
    search = "tab=wallet";
    await render();
    expect(container.querySelector("a")?.textContent).toBe("backToEventSettings");
    expect(container.querySelectorAll("h1")).toHaveLength(1);
  });
});
