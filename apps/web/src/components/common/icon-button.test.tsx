import userEvent from "@testing-library/user-event";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IconButton } from "./icon-button";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

describe("IconButton", () => {
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

  it("requires an accessible name and does not submit forms by default", async () => {
    const onClick = vi.fn();
    act(() => {
      root.render(
        <form>
          <IconButton label="Remove item" onClick={onClick} />
        </form>,
      );
    });

    const button = container.querySelector<HTMLButtonElement>("button");
    expect(button?.getAttribute("aria-label")).toBe("Remove item");
    expect(button?.type).toBe("button");
    await act(async () => userEvent.setup().click(button as HTMLButtonElement));
    expect(onClick).toHaveBeenCalledOnce();
  });
});
