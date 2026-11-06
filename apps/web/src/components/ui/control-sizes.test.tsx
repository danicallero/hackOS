import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Button } from "./button";
import { Checkbox } from "./checkbox";
import { Input } from "./input";
import { Switch } from "./switch";

// jsdom does not run Tailwind or media queries, so size/a11y guarantees are
// asserted on the design tokens the components reference and on the CSS that
// defines them (docs/DESIGN.md accessibility rules).
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

  it("maps button and input sizes to the same control-height token scale", () => {
    act(() => {
      root.render(
        <div>
          <Button data-testid="button-sm" size="sm">
            Compact
          </Button>
          <Input data-testid="input-sm" size="sm" />
          <Button data-testid="button-lg" size="lg">
            Prominent
          </Button>
          <Input data-testid="input-lg" size="lg" />
        </div>,
      );
    });
    const tokenOf = (id: string) =>
      /--control-height-(\w+)/.exec(
        container.querySelector(`[data-testid="${id}"]`)?.className ?? "",
      )?.[1];
    expect(tokenOf("button-sm")).toBe("compact");
    expect(container.querySelector('[data-testid="input-sm"]')?.getAttribute("data-size")).toBe(
      "sm",
    );
    expect(tokenOf("button-lg")).toBe("prominent");
    expect(container.querySelector('[data-testid="input-lg"]')?.className).toContain(
      "--control-height-prominent",
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
    for (const id of ["checkbox", "switch", "switch-sm"]) {
      const el = container.querySelector(`[data-testid="${id}"]`);
      expect(el?.className).toContain("(--target-min)");
      expect(el?.className).toContain("touch-target");
    }
    expect(readStyle("styles/theme.css")).toContain("--target-min: 1.5rem;");
  });

  it("bumps control heights to the touch target only for a coarse pointer", () => {
    const css = readStyle("styles/theme.css");
    expect(css).toContain("--target-touch: 2.75rem;");
    const at = css.indexOf("@media (pointer: coarse)");
    expect(at).toBeGreaterThan(-1);
    for (const token of ["tiny", "compact", "default", "prominent"]) {
      expect(css.slice(at)).toContain(`--control-height-${token}: var(--target-touch);`);
    }
    // Desktop values stay on the dense scale outside the coarse query.
    expect(css.slice(0, at)).toContain("--control-height-compact: 2rem;");
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
