import userEvent from "@testing-library/user-event";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";

vi.mock("@/lib/i18n", () => ({
  useLocale: () => ({ t: (key: string) => key }),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function NestedDropdown() {
  const [open, setOpen] = useState(true);

  return (
    <Dialog open={open} onOpenChange={setOpen} modal={false}>
      <DialogContent showCloseButton={false}>
        <DialogTitle>Review application</DialogTitle>
        <DialogDescription>Review controls</DialogDescription>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button">Judge</button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>Accept</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </DialogContent>
    </Dialog>
  );
}

describe("DropdownMenu nested in an overlay", () => {
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

  it("closes the menu from its trigger without dismissing the parent dialog", async () => {
    act(() => root.render(<NestedDropdown />));

    const user = userEvent.setup();
    const trigger = document.querySelector(
      '[data-slot="dropdown-menu-trigger"]',
    ) as HTMLButtonElement;

    await act(async () => user.click(trigger));

    const dialogContent = document.querySelector('[data-slot="dialog-content"]');
    const menuContent = document.querySelector('[data-slot="dropdown-menu-content"]');

    expect(dialogContent).not.toBeNull();
    expect(menuContent).not.toBeNull();
    expect(dialogContent?.contains(menuContent)).toBe(true);
    expect(document.body.style.pointerEvents).not.toBe("none");
    expect(dialogContent?.contains(document.activeElement)).toBe(true);

    await act(async () => user.click(trigger));

    expect(document.querySelector('[data-slot="dialog-content"]')).not.toBeNull();
    expect(
      document.querySelector('[data-slot="dropdown-menu-content"][data-state="open"]'),
    ).toBeNull();
  });
});
