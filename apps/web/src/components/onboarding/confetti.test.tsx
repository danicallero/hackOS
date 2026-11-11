import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Confetti } from "@/components/onboarding/confetti";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

function motion(reduce: boolean) {
  window.matchMedia = vi.fn().mockImplementation(() => ({
    matches: reduce,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("Confetti", () => {
  it("renders nothing when the system asks to reduce motion", async () => {
    motion(true);
    await act(async () => root.render(<Confetti />));
    expect(container.querySelector('[data-testid="onboarding-confetti"]')).toBeNull();
  });

  it("bursts, decoratively, when motion is allowed", async () => {
    motion(false);
    await act(async () => root.render(<Confetti />));
    const burst = container.querySelector('[data-testid="onboarding-confetti"]');
    expect(burst?.getAttribute("aria-hidden")).toBe("true");
    expect(burst?.children.length).toBeGreaterThan(10);
  });
});
