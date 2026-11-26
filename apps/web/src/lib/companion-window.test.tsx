import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCompanionWindowPreference } from "./companion-window";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const SAFARI_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

let root: Root | null = null;
let current: ReturnType<typeof useCompanionWindowPreference>;

function Probe() {
  current = useCompanionWindowPreference();
  return null;
}

const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
});

function mount() {
  const host = document.createElement("div");
  root = createRoot(host);
  act(() => root?.render(<Probe />));
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  store.clear();
  vi.restoreAllMocks();
});

describe("useCompanionWindowPreference (review window on links)", () => {
  it("is off by default on WebKit", () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(SAFARI_UA);
    mount();
    expect(current.windowOnLinks).toBe(false);
  });

  it("is on by default elsewhere", () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(CHROME_UA);
    mount();
    expect(current.windowOnLinks).toBe(true);
  });

  it("persists an explicit choice over the default", () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(CHROME_UA);
    mount();
    act(() => current.changeWindowOnLinks(false));
    act(() => root?.unmount());
    mount();
    expect(current.windowOnLinks).toBe(false);
  });
});
