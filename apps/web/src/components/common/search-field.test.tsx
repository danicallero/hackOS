import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/i18n", () => ({ useLocale: () => ({ t: (key: string) => key }) }));

import { focusListSearch } from "@/lib/shortcuts";
import { SearchField } from "./search-field";

let container: HTMLDivElement;
let root: Root;

function Harness({ collapsible }: { collapsible?: boolean }) {
  const [value, setValue] = useState("");
  return createElement(SearchField, {
    label: "Search people",
    value,
    onValueChange: setValue,
    collapsible,
  });
}

function render(collapsible?: boolean) {
  act(() => {
    root.render(createElement(Harness, { collapsible }));
  });
}

const input = () => container.querySelector<HTMLInputElement>("input[type=search]");
const trigger = () => container.querySelector<HTMLButtonElement>("button[data-shortcut-search]");

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("SearchField collapsible (short lists)", () => {
  it("stays an open field when not collapsible", () => {
    render(false);
    expect(input()).not.toBeNull();
    expect(trigger()).toBeNull();
  });

  it("starts as one icon button named after the field", () => {
    render(true);
    expect(input()).toBeNull();
    expect(trigger()?.getAttribute("aria-label")).toBe("Search people");
  });

  it("expands in place on click and focuses the input", () => {
    render(true);
    act(() => trigger()?.click());
    expect(input()).not.toBeNull();
    expect(document.activeElement).toBe(input());
  });

  it("expands from the / shortcut, which finds the collapsed trigger", () => {
    render(true);
    let claimed = false;
    act(() => {
      claimed = focusListSearch(document);
    });
    expect(claimed).toBe(true);
    expect(input()).not.toBeNull();
    expect(document.activeElement).toBe(input());
  });

  it("folds back on blur while empty, but never while it holds a query", () => {
    render(true);
    act(() => trigger()?.click());
    act(() => input()?.blur());
    expect(input()).toBeNull();

    act(() => trigger()?.click());
    const field = input() as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(field, "ana");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => input()?.blur());
    expect(input()?.value).toBe("ana");
  });

  it("folds back on Escape while empty", () => {
    render(true);
    act(() => trigger()?.click());
    act(() => {
      input()?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(input()).toBeNull();
  });
});
