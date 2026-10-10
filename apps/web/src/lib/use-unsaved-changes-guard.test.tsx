import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/i18n", () => ({
  useLocale: () => ({ t: (key: string) => key }),
}));

import { useUnsavedChangesGuard } from "./use-unsaved-changes-guard";

function Probe({ dirty, guardBrowserBack }: { dirty: boolean; guardBrowserBack?: boolean }) {
  useUnsavedChangesGuard(dirty, guardBrowserBack === undefined ? undefined : { guardBrowserBack });
  return null;
}

let container: HTMLDivElement;
let root: Root;
let pushState: ReturnType<typeof vi.spyOn>;
let addListener: ReturnType<typeof vi.spyOn>;

async function render(props: { dirty: boolean; guardBrowserBack?: boolean }) {
  await act(async () => {
    root.render(<Probe {...props} />);
  });
}

const popstateRegistrations = () =>
  addListener.mock.calls.filter(([type]: unknown[]) => type === "popstate").length;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  pushState = vi.spyOn(window.history, "pushState");
  addListener = vi.spyOn(window, "addEventListener");
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("useUnsavedChangesGuard browser Back", () => {
  it("pushes no history entry and registers no popstate listener by default", async () => {
    await render({ dirty: true });
    await render({ dirty: true });
    expect(pushState).not.toHaveBeenCalled();
    expect(popstateRegistrations()).toBe(0);
    expect(addListener.mock.calls.some(([type]: unknown[]) => type === "beforeunload")).toBe(true);
  });

  it("arms one sentinel and one popstate listener with guardBrowserBack, stable across rerenders", async () => {
    await render({ dirty: true, guardBrowserBack: true });
    await render({ dirty: true, guardBrowserBack: true });
    expect(pushState).toHaveBeenCalledTimes(1);
    expect(popstateRegistrations()).toBe(1);
  });

  it("does nothing while clean, even with guardBrowserBack", async () => {
    await render({ dirty: false, guardBrowserBack: true });
    expect(pushState).not.toHaveBeenCalled();
    expect(popstateRegistrations()).toBe(0);
  });
});
