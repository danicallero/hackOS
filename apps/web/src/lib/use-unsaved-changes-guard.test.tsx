import {
  AppRouterContext,
  type AppRouterInstance,
} from "next/dist/shared/lib/app-router-context.shared-runtime";
import { act, StrictMode, useContext } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/i18n", () => ({
  useLocale: () => ({ t: (key: string) => key }),
}));

import { UnsavedChangesProvider } from "@/components/common/unsaved-changes-provider";
import { useUnsavedChangesGuard } from "./use-unsaved-changes-guard";

function Probe({ dirty, guardBrowserBack }: { dirty: boolean; guardBrowserBack?: boolean }) {
  useUnsavedChangesGuard(dirty, guardBrowserBack === undefined ? undefined : { guardBrowserBack });
  const router = useContext(AppRouterContext);
  return (
    <>
      <a href="/other">Other page</a>
      <button type="button" onClick={() => router?.push("/other")}>
        Push
      </button>
      <button type="button" onClick={() => router?.push(window.location.href)}>
        Same route
      </button>
    </>
  );
}

let container: HTMLDivElement;
let root: Root;
let pushState: ReturnType<typeof vi.spyOn>;
let router: AppRouterInstance;
let addListener: ReturnType<typeof vi.spyOn>;

async function render(props: { dirty: boolean; guardBrowserBack?: boolean }) {
  await act(async () => {
    root.render(
      <AppRouterContext.Provider value={router}>
        <UnsavedChangesProvider>
          <Probe {...props} />
        </UnsavedChangesProvider>
      </AppRouterContext.Provider>,
    );
  });
}

const popstateRegistrations = () =>
  addListener.mock.calls.filter(([type]: unknown[]) => type === "popstate").length;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  router = {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  };
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

async function click(label: string) {
  const button = Array.from(document.querySelectorAll("button, a")).find(
    (element) => element.textContent === label,
  );
  expect(button).toBeTruthy();
  await act(async () => {
    (button as HTMLElement).click();
  });
}

describe("unsaved changes confirmation (#1180)", () => {
  it("blocks a link, focuses Keep editing and cancels without navigating", async () => {
    await render({ dirty: true });
    await click("Other page");
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(document.activeElement?.textContent).toBe("keepEditing");
    await click("keepEditing");
    expect(router.push).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it("accepts a link once, including after unrelated rerenders", async () => {
    await render({ dirty: true });
    await click("Other page");
    await render({ dirty: true });
    await click("discardLibraryChanges");
    expect(router.push).toHaveBeenCalledExactlyOnceWith(
      new URL("/other", window.location.href).href,
    );
  });

  it("guards router pushes and ignores navigation to the current URL", async () => {
    await render({ dirty: true });
    await click("Same route");
    expect(router.push).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    await click("Push");
    await click("keepEditing");
    expect(router.push).not.toHaveBeenCalled();
    await click("Push");
    await click("Push");
    await click("discardLibraryChanges");
    expect(router.push).toHaveBeenCalledExactlyOnceWith("/other", undefined);
  });

  it("rearms Back on cancel and steps back only on acceptance", async () => {
    const back = vi.spyOn(window.history, "go").mockImplementation(() => {});
    await render({ dirty: true, guardBrowserBack: true });
    await act(async () => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await click("keepEditing");
    expect(back).not.toHaveBeenCalled();
    expect(pushState).toHaveBeenCalledTimes(2);
    await render({ dirty: true, guardBrowserBack: true });
    expect(pushState).toHaveBeenCalledTimes(2);
    await act(async () => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await click("discardLibraryChanges");
    expect(back).toHaveBeenCalledExactlyOnceWith(-2);
  });

  it("preserves native beforeunload only while dirty", async () => {
    await render({ dirty: true });
    const dirtyUnload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirtyUnload);
    expect(dirtyUnload.defaultPrevented).toBe(true);
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    await render({ dirty: false });
    const cleanUnload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(cleanUnload);
    expect(cleanUnload.defaultPrevented).toBe(false);
  });
});

it("arms only once through StrictMode effect replay (#1180, R003)", async () => {
  await act(async () => {
    root.render(
      <StrictMode>
        <UnsavedChangesProvider>
          <Probe dirty guardBrowserBack />
        </UnsavedChangesProvider>
      </StrictMode>,
    );
  });
  expect(pushState).toHaveBeenCalledTimes(1);
});
