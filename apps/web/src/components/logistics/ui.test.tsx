import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Field, InlineError } from "./ui";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

describe("logistics form primitives", () => {
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

  it("associates controls and reserves the label block for a subtitle", () => {
    act(() => {
      root.render(
        <div>
          <Field id="badge" label="Badge" hint="Use the printed identifier.">
            <input id="badge" />
          </Field>
          <Field id="direction" label="Direction">
            <input id="direction" />
          </Field>
        </div>,
      );
    });

    const label = container.querySelector<HTMLLabelElement>('label[for="badge"]');
    const labelBlock = label?.parentElement;
    expect(label).not.toBeNull();
    expect(labelBlock?.className).toContain("min-h-9");
    expect(container.querySelector('label[for="direction"]')).not.toBeNull();
  });

  it("announces inline scanner errors and hides the decorative icon", () => {
    act(() => root.render(<InlineError message="The badge could not be read." />));

    const error = container.querySelector('[role="alert"]');
    expect(error?.getAttribute("aria-live")).toBe("assertive");
    expect(error?.getAttribute("aria-atomic")).toBe("true");
    expect(error?.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });
});
