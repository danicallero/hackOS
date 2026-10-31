import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ShortcutKbd, ShortcutTooltip } from "./shortcut-hint";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

beforeAll(() => {
  // Radix measures the tooltip arrow.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

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
  vi.restoreAllMocks();
});

function render(node: React.ReactNode) {
  act(() => root.render(node));
  return container.querySelector("button") as HTMLButtonElement;
}

/** Keyboard focus opens the tooltip, like hover does. */
function focusTooltip(trigger: HTMLElement) {
  act(() => trigger.focus());
  return document.querySelector<HTMLElement>('[data-slot="tooltip-content"]');
}

describe("ShortcutTooltip (#1182)", () => {
  it("shows the label followed by the shortcut for a labelled control", () => {
    const trigger = render(
      <ShortcutTooltip shortcut="toggleSidebar" label="Toggle sidebar">
        <button type="button" aria-label="Toggle sidebar" />
      </ShortcutTooltip>,
    );
    const content = focusTooltip(trigger);
    expect(content?.firstChild?.textContent).toBe("Toggle sidebar");
    expect(content?.querySelector("kbd")?.textContent).toBe("Ctrl+B");
    expect(trigger.getAttribute("aria-keyshortcuts")).toBe("Control+B");
  });

  it("shows only the shortcut when the control's text already names it", () => {
    const trigger = render(
      <ShortcutTooltip shortcut="save">
        <button type="submit">Save changes</button>
      </ShortcutTooltip>,
    );
    const content = focusTooltip(trigger);
    expect(content?.firstChild?.nodeName).toBe("KBD");
    expect(content?.querySelector("kbd")?.textContent).toBe("Ctrl+S");
    expect(trigger.getAttribute("aria-keyshortcuts")).toBe("Control+S");
  });

  it("uses ⌘ and Meta on Apple platforms", () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    const trigger = render(
      <ShortcutTooltip shortcut="commandPalette" label="Quick search">
        <button type="button">Quick search</button>
      </ShortcutTooltip>,
    );
    expect(focusTooltip(trigger)?.querySelector("kbd")?.textContent).toBe("⌘K");
    expect(trigger.getAttribute("aria-keyshortcuts")).toBe("Meta+K");
  });

  it("stays announced while a visible hint replaces the tooltip", () => {
    const trigger = render(
      <ShortcutTooltip shortcut="commandPalette" label="Quick search" hidden>
        <button type="button">
          Quick search <ShortcutKbd shortcut="commandPalette" aria-hidden="true" />
        </button>
      </ShortcutTooltip>,
    );
    expect(focusTooltip(trigger)?.hidden).toBe(true);
    expect(trigger.getAttribute("aria-keyshortcuts")).toBe("Control+K");
    expect(trigger.querySelector("kbd")?.textContent).toBe("Ctrl+K");
  });
});
