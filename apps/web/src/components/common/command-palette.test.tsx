import { CAPABILITIES, type Capability } from "@hackos/shared/capabilities";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { isNavItemVisible, type NavItem } from "@/lib/nav";

const router = vi.hoisted(() => ({ push: vi.fn(), pathname: "/event" }));
const session = vi.hoisted(() => ({ capabilities: [] as string[] }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: router.push }),
  usePathname: () => router.pathname,
}));
vi.mock("@/lib/i18n", () => ({
  useLocale: () => ({ language: "en", t: (key: string) => key }),
}));
// The sidebar's predicate over a stubbed session: gating stays capability-based.
vi.mock("@/components/layout/app-sidebar", () => ({
  useNavVisibility: () => (item: NavItem) => {
    const can = (capability: Capability) => session.capabilities.includes(capability);
    return isNavItemVisible(item, {
      can,
      canAny: (...capabilities: Capability[]) => capabilities.some(can),
      isEnterpriseJudge: false,
      isSponsorRep: false,
      isPureApplicant: false,
      hasProject: true,
      hasQueueItems: true,
      hasStatisticsPanels: false,
    });
  },
}));

import { SAVE_SHORTCUT_ATTR, setCommandPaletteOpen } from "@/lib/shortcuts";
import { CommandPalette } from "./command-palette";
import { FormActions } from "./form-actions";
import { SearchField } from "./search-field";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

beforeAll(() => {
  // cmdk measures its list and scrolls the selected item into view.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => {};
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  router.push.mockReset();
  router.pathname = "/event";
  session.capabilities = [];
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  setCommandPaletteOpen(false);
});

function press(
  target: EventTarget,
  key: string,
  modifiers: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean } = {},
) {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...modifiers,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const optionValues = () =>
  Array.from(document.querySelectorAll("[cmdk-item]")).map((item) =>
    item.getAttribute("data-value"),
  );

describe("CommandPalette quick search (#1182)", () => {
  it("opens with Ctrl+K and lists only the destinations the capabilities grant", async () => {
    session.capabilities = [CAPABILITIES.USERS_READ];
    await act(async () => root.render(<CommandPalette />));
    expect(dialog()).toBeNull();

    const event = press(document.body, "k", { ctrlKey: true });
    expect(event.defaultPrevented).toBe(true);
    expect(dialog()).not.toBeNull();
    const values = optionValues();
    expect(values).toContain("/users");
    expect(values).toContain("/event");
    expect(values).not.toContain("/permissions");
    expect(values).not.toContain("/audit");
  });

  it("opens from inside a text field, where only chorded keys apply", async () => {
    await act(async () =>
      root.render(
        <>
          <input aria-label="note" />
          <CommandPalette />
        </>,
      ),
    );
    const input = container.querySelector("input") as HTMLInputElement;
    input.focus();
    press(input, "k", { ctrlKey: true });
    expect(dialog()).not.toBeNull();
  });

  it("navigates to the chosen destination and closes", async () => {
    session.capabilities = [CAPABILITIES.USERS_READ];
    await act(async () => root.render(<CommandPalette />));
    press(document.body, "k", { ctrlKey: true });
    const users = document.querySelector('[cmdk-item][data-value="/users"]') as HTMLElement;
    act(() => users.click());
    expect(router.push).toHaveBeenCalledWith("/users");
    expect(dialog()).toBeNull();
  });

  it("does not navigate to the page already open", async () => {
    await act(async () => root.render(<CommandPalette />));
    press(document.body, "k", { ctrlKey: true });
    const home = document.querySelector('[cmdk-item][data-value="/event"]') as HTMLElement;
    act(() => home.click());
    expect(router.push).not.toHaveBeenCalled();
    expect(dialog()).toBeNull();
  });

  it("hints the remaining shortcuts in its footer", async () => {
    await act(async () => root.render(<CommandPalette />));
    press(document.body, "k", { ctrlKey: true });
    const hints = document.querySelector('[aria-label="keyboardShortcuts"]');
    expect(hints?.textContent).toContain("Ctrl+S");
    expect(hints?.textContent).toContain("/");
  });
});

describe("`/` focuses the list search (#1182)", () => {
  function SearchPage() {
    return (
      <>
        <input aria-label="other" />
        <SearchField label="Search users" value="" onValueChange={() => {}} />
        <CommandPalette />
      </>
    );
  }

  it("focuses the SearchField when nothing is being typed", async () => {
    await act(async () => root.render(<SearchPage />));
    const event = press(document.body, "/");
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement?.getAttribute("type")).toBe("search");
  });

  it("leaves `/` to the text field that has focus", async () => {
    await act(async () => root.render(<SearchPage />));
    const other = container.querySelector('input[aria-label="other"]') as HTMLInputElement;
    other.focus();
    const event = press(other, "/");
    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(other);
  });

  it("keeps the browser's own `/` when the page has no list search", async () => {
    await act(async () => root.render(<CommandPalette />));
    expect(press(document.body, "/").defaultPrevented).toBe(false);
  });
});

describe("⌘S / Ctrl+S saves the focused save owner (#1182)", () => {
  function Editor({
    id,
    state,
    onSubmit,
  }: {
    id: string;
    state: "saved" | "unsaved";
    onSubmit: () => void;
  }) {
    return (
      <form
        id={id}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <input aria-label={id} />
        <FormActions pending={false} state={state} />
      </form>
    );
  }

  it("submits a focused form with unsaved changes once", async () => {
    const onSubmit = vi.fn();
    await act(async () =>
      root.render(
        <>
          <Editor id="profile" state="unsaved" onSubmit={onSubmit} />
          <CommandPalette />
        </>,
      ),
    );
    const input = container.querySelector("input") as HTMLInputElement;
    input.focus();
    const event = press(input, "s", { ctrlKey: true });
    expect(event.defaultPrevented).toBe(true);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("claims the key in a clean editor without submitting it", async () => {
    const onSubmit = vi.fn();
    await act(async () =>
      root.render(
        <>
          <Editor id="profile" state="saved" onSubmit={onSubmit} />
          <CommandPalette />
        </>,
      ),
    );
    const input = container.querySelector("input") as HTMLInputElement;
    input.focus();
    expect(press(input, "s", { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("saves the only dirty owner when focus is outside every form", async () => {
    const dirty = vi.fn();
    const clean = vi.fn();
    await act(async () =>
      root.render(
        <>
          <Editor id="a" state="unsaved" onSubmit={dirty} />
          <Editor id="b" state="saved" onSubmit={clean} />
          <CommandPalette />
        </>,
      ),
    );
    expect(press(document.body, "s", { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(dirty).toHaveBeenCalledTimes(1);
    expect(clean).not.toHaveBeenCalled();
  });

  it("does nothing when several owners are dirty and none has focus", async () => {
    const a = vi.fn();
    const b = vi.fn();
    await act(async () =>
      root.render(
        <>
          <Editor id="a" state="unsaved" onSubmit={a} />
          <Editor id="b" state="unsaved" onSubmit={b} />
          <CommandPalette />
        </>,
      ),
    );
    expect(press(document.body, "s", { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
  });

  it("marks the save button with its state for the shortcut", async () => {
    await act(async () => root.render(<Editor id="a" state="unsaved" onSubmit={() => {}} />));
    const button = container.querySelector(`button[${SAVE_SHORTCUT_ATTR}]`);
    expect(button?.getAttribute(SAVE_SHORTCUT_ATTR)).toBe("unsaved");
    expect(button?.getAttribute("aria-keyshortcuts")).toBe("Control+S");
  });
});
