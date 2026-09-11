import userEvent from "@testing-library/user-event";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { AlertModal } from "./alert-modal";

vi.mock("@/lib/i18n", () => ({
  useLocale: () => ({ t: (key: string) => key }),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function AlertWithPopover() {
  const [popoverOpen, setPopoverOpen] = useState(false);

  return (
    <AlertModal
      open
      title="Confirm action"
      description="Confirm the action"
      cancelLabel="Cancel"
      confirmLabel="Confirm"
      onConfirm={() => undefined}
    >
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger asChild>
          <button type="button">Open details</button>
        </PopoverTrigger>
        <PopoverContent>
          <button type="button">Popover action</button>
        </PopoverContent>
      </Popover>
    </AlertModal>
  );
}

function DialogWithAlertModal() {
  const [dialogOpen, setDialogOpen] = useState(true);
  const [alertOpen, setAlertOpen] = useState(false);

  return (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen} modal={false}>
      <DialogContent showCloseButton={false}>
        <DialogTitle>Review application</DialogTitle>
        <DialogDescription>Review controls</DialogDescription>
        <AlertModal
          open={alertOpen}
          onOpenChange={setAlertOpen}
          title="Confirm action"
          description="Confirm the action"
          cancelLabel="Cancel"
          confirmLabel="Confirm"
          onConfirm={() => undefined}
          trigger={<button type="button">Open confirmation</button>}
        />
      </DialogContent>
    </Dialog>
  );
}

describe("overlay children inside AlertModal", () => {
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

  it("keeps the child popover inside the confirmation focus scope", async () => {
    act(() => root.render(<AlertWithPopover />));

    const user = userEvent.setup();
    const trigger = document.querySelector('[data-slot="popover-trigger"]') as HTMLButtonElement;

    await act(async () => user.click(trigger));

    const alertContent = document.querySelector('[data-slot="alert-dialog-content"]');
    const popoverContent = document.querySelector('[data-slot="popover-content"]');

    expect(alertContent).not.toBeNull();
    expect(popoverContent).not.toBeNull();
    expect(alertContent?.contains(popoverContent)).toBe(true);
    expect(alertContent?.contains(document.activeElement)).toBe(true);

    await act(async () => user.click(trigger));

    expect(document.querySelector('[data-slot="alert-dialog-content"]')).not.toBeNull();
    expect(document.querySelector('[data-slot="popover-content"][data-state="open"]')).toBeNull();
  });

  it("closes a nested confirmation without dismissing the parent dialog", async () => {
    act(() => root.render(<DialogWithAlertModal />));

    const user = userEvent.setup();
    await act(async () => user.click(document.querySelector("button") as HTMLButtonElement));

    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();

    const cancelButton = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "Cancel",
    );
    await act(async () => user.click(cancelButton as HTMLButtonElement));

    expect(document.querySelector('[data-slot="dialog-content"]')).not.toBeNull();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });
});
