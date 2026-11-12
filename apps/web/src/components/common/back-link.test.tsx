import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const back = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => ({ back }) }));
vi.mock("next/link", () => ({
  default: ({ href, ...props }: React.ComponentProps<"a"> & { href: string }) =>
    createElement("a", { href, ...props }),
}));
vi.mock("@/lib/i18n", () => ({
  useLocale: () => ({
    t: (key: string, params?: Record<string, string>) => (params ? `${key}:${params.name}` : key),
  }),
}));

import { installInAppHistory, uninstallInAppHistory } from "@/lib/in-app-history";
import { BackLink } from "./back-link";

let container: HTMLDivElement;
let root: Root;

function render(href = "/users") {
  act(() => {
    root.render(createElement(BackLink, { href, label: "Users" }));
  });
  return container.querySelector("a") as HTMLAnchorElement;
}

function click(anchor: HTMLAnchorElement, init: MouseEventInit = {}) {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init });
  // What the link itself decided, before this listener stops jsdom from really navigating.
  let prevented = false;
  const settle = (e: Event) => {
    prevented = e.defaultPrevented;
    e.preventDefault();
  };
  document.addEventListener("click", settle, { once: true });
  act(() => {
    anchor.dispatchEvent(event);
  });
  return { defaultPrevented: prevented };
}

beforeEach(() => {
  back.mockReset();
  window.history.replaceState(null, "", "/");
  installInAppHistory();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  uninstallInAppHistory();
});

describe("BackLink (record back navigation)", () => {
  it("steps back through history when the entry below is the parent list", () => {
    window.history.pushState(null, "", "/users?search=ana&page=2");
    window.history.pushState(null, "", "/users/7");
    const anchor = render();
    expect(anchor.textContent).toBe("Users");
    expect(anchor.getAttribute("aria-label")).toBe("backToParent:Users");
    const event = click(anchor);
    expect(event.defaultPrevented).toBe(true);
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("goes to the canonical parent when the page was opened directly", () => {
    window.history.replaceState(null, "", "/users/7");
    const anchor = render();
    const event = click(anchor);
    expect(event.defaultPrevented).toBe(false);
    expect(anchor.getAttribute("href")).toBe("/users");
    expect(back).not.toHaveBeenCalled();
  });

  it("goes to the canonical parent when the previous page was another one", () => {
    window.history.pushState(null, "", "/audit");
    window.history.pushState(null, "", "/users/7");
    const event = click(render());
    expect(event.defaultPrevented).toBe(false);
    expect(back).not.toHaveBeenCalled();
  });

  it("does not trust an entry that a replace navigation overwrote", () => {
    window.history.pushState(null, "", "/elsewhere");
    window.history.pushState(null, "", "/users");
    window.history.replaceState(null, "", "/users/7");
    // The parent was replaced by the record, so the entry below is "/elsewhere".
    const event = click(render());
    expect(event.defaultPrevented).toBe(false);
    expect(back).not.toHaveBeenCalled();
  });

  it("does not mutate history when already at the target", () => {
    window.history.replaceState(null, "", "/users");
    const push = vi.spyOn(window.history, "pushState");
    const replace = vi.spyOn(window.history, "replaceState");
    const event = click(render());
    expect(event.defaultPrevented).toBe(true);
    expect(back).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it("leaves modified clicks to the browser", () => {
    window.history.pushState(null, "", "/users");
    window.history.pushState(null, "", "/users/7");
    const event = click(render(), { ctrlKey: true });
    expect(event.defaultPrevented).toBe(false);
    expect(back).not.toHaveBeenCalled();
  });
});
