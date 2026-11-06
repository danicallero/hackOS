import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Button } from "./button";
import { Checkbox } from "./checkbox";
import { Input } from "./input";
import { Switch } from "./switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip";

const readStyle = (path: string) => readFileSync(resolve(process.cwd(), "src", path), "utf8");

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

describe("shared control sizing", () => {
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
  });

  it("maps action and field variants to the same token scale", () => {
    act(() => {
      root.render(
        <div>
          <Button data-testid="button-default">Default</Button>
          <Button data-testid="button-sm" size="sm">
            Compact
          </Button>
          <Button data-testid="button-lg" size="lg">
            Prominent
          </Button>
          <Button data-testid="button-icon-xs" size="icon-xs" aria-label="Remove" />
          <Input data-testid="input-default" />
          <Input data-testid="input-sm" size="sm" />
          <Input data-testid="input-lg" size="lg" />
        </div>,
      );
    });

    expect(container.querySelector('[data-testid="button-default"]')?.getAttribute("data-size")).toBe(
      "default",
    );
    expect(container.querySelector('[data-testid="button-default"]')?.className).toContain(
      "h-[var(--control-height-default)]",
    );
    expect(container.querySelector('[data-testid="button-sm"]')?.className).toContain(
      "h-[var(--control-height-compact)]",
    );
    expect(container.querySelector('[data-testid="button-lg"]')?.className).toContain(
      "h-[var(--control-height-prominent)]",
    );
    expect(container.querySelector('[data-testid="button-icon-xs"]')?.className).toContain(
      "size-[var(--control-height-tiny)]",
    );
    expect(container.querySelector('[data-testid="input-default"]')?.getAttribute("data-size")).toBe(
      "default",
    );
    expect(container.querySelector('[data-testid="input-default"]')?.className).toContain(
      "data-[size=default]:h-[var(--control-height-default)]",
    );
    expect(container.querySelector('[data-testid="input-sm"]')?.className).toContain(
      "data-[size=sm]:h-[var(--control-height-compact)]",
    );
    expect(container.querySelector('[data-testid="input-lg"]')?.className).toContain(
      "data-[size=lg]:h-[var(--control-height-prominent)]",
    );
  });

  it("keeps checkboxes and switches at the 24 px minimum target with a touch hit area", () => {
    act(() => {
      root.render(
        <div>
          <Checkbox data-testid="checkbox" aria-label="Select" />
          <Switch data-testid="switch" aria-label="Enable" />
          <Switch data-testid="switch-sm" size="sm" aria-label="Enable small" />
        </div>,
      );
    });

    const checkbox = container.querySelector('[data-testid="checkbox"]');
    expect(checkbox?.className).toContain("size-(--target-min)");
    expect(checkbox?.className).toContain("touch-target");
    for (const id of ["switch", "switch-sm"]) {
      const el = container.querySelector(`[data-testid="${id}"]`);
      expect(el?.className).toContain("h-(--target-min)");
      expect(el?.className).toContain("touch-target");
    }
  });

  it("bumps control heights to the touch target only for a coarse pointer", () => {
    const css = readStyle("styles/theme.css");
    expect(css).toContain("--target-min: 1.5rem;");
    expect(css).toContain("--target-touch: 2.75rem;");
    const coarse = css.slice(css.indexOf("@media (pointer: coarse)"));
    for (const token of ["tiny", "compact", "default", "prominent"]) {
      expect(coarse).toContain(`--control-height-${token}: var(--target-touch);`);
    }
    // Desktop values stay on the dense scale outside the coarse query.
    expect(css.slice(0, css.indexOf("@media (pointer: coarse)"))).toContain(
      "--control-height-compact: 2rem;",
    );
    expect(readStyle("app/globals.css")).toContain(".touch-target::after");
  });

  it("strengthens neutrals under prefers-contrast: more in both themes", () => {
    const css = readStyle("styles/theme.css");
    const more = css.slice(css.indexOf("@media (prefers-contrast: more)"));
    expect(more).toMatch(/:root \{[^}]*--border:[^}]*--muted-foreground:[^}]*--ring:/);
    expect(more).toMatch(/\.dark \{[^}]*--border:[^}]*--muted-foreground:[^}]*--ring:/);
  });

  it("drops overlay animation and blur under the reduced-motion and reduced-transparency queries", () => {
    const css = readStyle("app/globals.css");
    const motion = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce) {\n  [class*="));
    for (const name of ["animate-in", "animate-out", "animate-pulse", "animate-spin"]) {
      expect(motion).toContain(`[class*="${name}"]`);
    }
    expect(css).toContain("@media (prefers-reduced-transparency: reduce)");
    expect(css).toContain("backdrop-filter: none;");
  });
});

describe("tooltip timing", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root.render(
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger>Hover me</TooltipTrigger>
            <TooltipContent>Hint text</TooltipContent>
          </Tooltip>
        </TooltipProvider>,
      );
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const hasTip = () => document.querySelector('[data-slot="tooltip-content"]') !== null;

  it("waits about 500 ms before opening on pointer hover", () => {
    const trigger = container.querySelector("button") as HTMLButtonElement;
    act(() => {
      trigger.dispatchEvent(new MouseEvent("pointermove", { bubbles: true }));
      vi.advanceTimersByTime(300);
    });
    expect(hasTip()).toBe(false);
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(hasTip()).toBe(true);
  });

  it("opens immediately on keyboard focus", () => {
    const trigger = container.querySelector("button") as HTMLButtonElement;
    act(() => {
      trigger.focus();
    });
    expect(hasTip()).toBe(true);
  });
});
