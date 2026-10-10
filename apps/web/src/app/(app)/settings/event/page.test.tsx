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
vi.mock("./venue-tab", () => ({ VenueTab: () => <div data-testid="venue-form" /> }));
vi.mock("./wallet-tab", () => ({ WalletTab: () => <div data-testid="wallet-form" /> }));
vi.mock("./presence-tab", () => ({ PresenceTab: () => null }));
vi.mock("./invites-tab", () => ({ InvitesTab: () => null }));
vi.mock("./reset-judging-data-tab", () => ({ ResetJudgingDataTab: () => null }));
vi.mock("../../queue/rooms/judging-window-tab", () => ({ JudgingWindowTab: () => null }));

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
  caps = new Set(["event:manage", "wallet:manage"]);
  replace.mockClear();
  push.mockClear();
});

afterEach(() => {
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

  it("never mutates history across rerenders", async () => {
    search = "tab=event";
    await render();
    await render();
    expect(replace).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });
});
