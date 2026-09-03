import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Button } from "./button";
import { Input } from "./input";

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
});
