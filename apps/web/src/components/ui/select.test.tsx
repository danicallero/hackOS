import userEvent from "@testing-library/user-event";
import { act } from "react";
import { useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";

vi.mock("@/lib/i18n", () => ({
  useLocale: () => ({ t: (key: string) => key }),
}));

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
          <SelectTrigger size="content">
            <SelectValue placeholder="A very long translated selected value" />
          </SelectTrigger>
        </Select>,
      );
    });

    const trigger = container.querySelector("button");
    expect(trigger?.getAttribute("data-size")).toBe("content");
    expect(trigger?.className).toContain("data-[size=content]:whitespace-normal");
    expect(trigger?.className).toContain("data-[size=content]:h-auto");
    expect(trigger?.className).toContain("data-[size=content]:*:data-[slot=select-value]:whitespace-normal");
    expect(trigger?.className).toContain("*:data-[slot=select-value]:truncate");
  });
});

function NestedSelect() {
  const [dialogOpen, setDialogOpen] = useState(true);

  return (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen} modal={false}>
      <DialogContent showCloseButton={false}>
        <DialogTitle>Review application</DialogTitle>
        <DialogDescription>Review controls</DialogDescription>
        <Select defaultValue="one">
          <SelectTrigger aria-label="Choice">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="one">One</SelectItem>
            <SelectItem value="two">Two</SelectItem>
          </SelectContent>
        </Select>
      </DialogContent>
    </Dialog>
  );
}

describe("Select nested in an overlay", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    HTMLElement.prototype.hasPointerCapture ??= () => false;
    HTMLElement.prototype.releasePointerCapture ??= () => undefined;
    HTMLElement.prototype.scrollIntoView ??= () => undefined;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("keeps the parent dialog focused and clickable while open", async () => {
    act(() => root.render(<NestedSelect />));

    const user = userEvent.setup();
    const trigger = document.querySelector('[data-slot="select-trigger"]') as HTMLButtonElement;

    await act(async () => user.click(trigger));

    const dialogContent = document.querySelector('[data-slot="dialog-content"]');
    const selectContent = document.querySelector('[data-slot="select-content"]');

    expect(dialogContent).not.toBeNull();
    expect(selectContent).not.toBeNull();
    expect(dialogContent?.contains(selectContent)).toBe(true);
    expect(dialogContent?.contains(document.activeElement)).toBe(true);
    expect(trigger.style.pointerEvents).toBe("auto");

    await act(async () => user.click(trigger));

    expect(document.querySelector('[data-slot="dialog-content"]')).not.toBeNull();
    expect(document.querySelector('[data-slot="select-content"][data-state="open"]')).toBeNull();
  });
});
