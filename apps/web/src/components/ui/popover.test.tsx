import userEvent from "@testing-library/user-event";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./dialog";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

vi.mock("@/lib/i18n", () => ({
  useLocale: () => ({ t: (key: string) => key }),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function NestedPopover() {
  const [dialogOpen, setDialogOpen] = useState(true);
  const [popoverOpen, setPopoverOpen] = useState(false);

  return (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen} modal={false}>
      <DialogContent showCloseButton={false}>
        <DialogTitle>Review application</DialogTitle>
        <DialogDescription>Review controls</DialogDescription>
        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
          <PopoverTrigger asChild>
            <button type="button">Open details</button>
          </PopoverTrigger>
          <PopoverContent>
            <button type="button">Popover action</button>
          </PopoverContent>
        </Popover>
      </DialogContent>
    </Dialog>
  );
}

function NestedPopoverInPopover() {
  const [outerOpen, setOuterOpen] = useState(true);
  const [innerOpen, setInnerOpen] = useState(false);

  return (
    <Popover open={outerOpen} onOpenChange={setOuterOpen}>
      <PopoverTrigger asChild>
        <button type="button">Open outer details</button>
      </PopoverTrigger>
      <PopoverContent>
        <Popover open={innerOpen} onOpenChange={setInnerOpen}>
          <PopoverTrigger asChild>
            <button type="button">Open inner details</button>
          </PopoverTrigger>
          <PopoverContent>
            <button type="button">Inner action</button>
          </PopoverContent>
        </Popover>
      </PopoverContent>
    </Popover>
  );
}

describe("Popover nested in an overlay", () => {
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

  it("keeps its content and focus inside the parent dialog", async () => {
    act(() => root.render(<NestedPopover />));

    const user = userEvent.setup();
    const trigger = document.querySelector('[data-slot="popover-trigger"]') as HTMLButtonElement;

    await act(async () => user.click(trigger));

    const dialogContent = document.querySelector('[data-slot="dialog-content"]');
    const popoverContent = document.querySelector('[data-slot="popover-content"]');

    expect(dialogContent).not.toBeNull();
    expect(popoverContent).not.toBeNull();
    expect(dialogContent?.contains(popoverContent)).toBe(true);
    expect(dialogContent?.contains(document.activeElement)).toBe(true);

    await act(async () => user.click(trigger));

    expect(document.querySelector('[data-slot="dialog-content"]')).not.toBeNull();
    expect(document.querySelector('[data-slot="popover-content"][data-state="open"]')).toBeNull();
  });

  it("keeps a nested popover inside its open parent", async () => {
    act(() => root.render(<NestedPopoverInPopover />));

    const user = userEvent.setup();
    const innerTrigger = Array.from(
      document.querySelectorAll('[data-slot="popover-trigger"]'),
    ).find((node) => node.textContent === "Open inner details") as HTMLButtonElement;

    await act(async () => user.click(innerTrigger));

    const contents = document.querySelectorAll('[data-slot="popover-content"]');
    expect(contents).toHaveLength(2);
    expect(contents[0]?.contains(contents[1] ?? null)).toBe(true);

    await act(async () => user.click(innerTrigger));

    expect(document.querySelectorAll('[data-slot="popover-content"]')).toHaveLength(1);
  });
});
