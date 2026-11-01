import { getByRole, waitFor } from "@testing-library/dom";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Toaster } from "./sileo";
import { toast } from "@/lib/toast";

vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));
vi.mock("@/lib/i18n", () => ({ useLocale: () => ({ t: (key: string) => key }), isLanguage: () => true, translateMessage: (_language: string, key: string) => key }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<Toaster position="top-right" />));
});
afterEach(async () => { await act(async () => root.unmount()); toast.clear(); host.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it("mounts a stable live region before feedback and exposes an independent dismiss button", async () => {
  const region = host.querySelector('[aria-live="polite"]');
  expect(region).not.toBeNull();
  await act(async () => { toast.error("Could not save"); });
  expect(host.querySelector('[aria-live="polite"]')).toBe(region);
  const node = host.querySelector('[data-sileo-toast]') as HTMLElement;
  expect(node.tagName).toBe("DIV");
  await waitFor(() => expect(getByRole(node, "button", { name: "close" })).toBeTruthy());
  const close = getByRole(node, "button", { name: "close" });
  expect(close.tagName).toBe("BUTTON");
  close.focus();
  await act(async () => userEvent.keyboard("{Enter}"));
  expect(node.dataset.exiting).toBe("true");
});

it("keeps error feedback after the previous timeout", async () => {
  vi.useFakeTimers();
  await act(async () => { toast.error("Could not save"); });
  await act(async () => vi.advanceTimersByTime(10_000));
  const node = host.querySelector('[data-sileo-toast]') as HTMLElement;
  expect(node).not.toBeNull();
  expect(node.dataset.exiting).not.toBe("true");
});

it("uses a native action button rather than a nested anchor", async () => {
  const onClick = vi.fn();
  await act(async () => { toast.action("Result ready", { action: { label: "Open", onClick } }); });
  const node = host.querySelector('[data-sileo-toast]') as HTMLElement;
  const action = getByRole(node, "button", { name: "Open", hidden: true });
  expect(action.tagName).toBe("BUTTON");
  expect(action.closest("button button")).toBeNull();
  await act(async () => { getByRole(node, "button", { name: "Result ready", expanded: false }).focus(); });
  await waitFor(() => expect(node.dataset.expanded).toBe("true"));
  action.focus();
  await act(async () => userEvent.keyboard("{Enter}"));
  expect(onClick).toHaveBeenCalledOnce();
});
