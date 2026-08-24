import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Select, SelectTrigger, SelectValue } from "./select";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

describe("SelectTrigger", () => {
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

  it("keeps selected values readable when translated text needs multiple lines", () => {
    act(() => {
      root.render(
        <Select>
          <SelectTrigger>
            <SelectValue placeholder="A very long translated selected value" />
          </SelectTrigger>
        </Select>,
      );
    });

    const trigger = container.querySelector("button");
    expect(trigger?.className).toContain("whitespace-normal");
    expect(trigger?.className).toContain("h-auto");
    expect(trigger?.className).toContain("*:data-[slot=select-value]:wrap-break-word");
    expect(trigger?.className).not.toContain("whitespace-nowrap");
    expect(trigger?.className).not.toContain("line-clamp-1");
  });
});
