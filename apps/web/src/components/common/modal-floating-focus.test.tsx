import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Modal } from "./modal";

vi.mock("@/lib/i18n", () => ({
  useLocale: () => ({ t: (key: string) => key }),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

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

it("keeps a floating review dialog open when focus lands behind it (H13)", async () => {
  const onOpenChange = vi.fn();
  await act(async () => {
    root.render(
      <>
        <input aria-label="Background search" />
        <Modal
          open
          onOpenChange={onOpenChange}
          title="Applicant"
          floatingContent={<div data-dialog-floating>Viewer</div>}
          floatingFocus
        >
          <button type="button">Inside</button>
        </Modal>
      </>,
    );
  });

  const background = container.querySelector<HTMLInputElement>("input")!;
  await act(async () => {
    background.focus();
    background.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  });

  expect(onOpenChange).not.toHaveBeenCalledWith(false);
  expect(document.querySelector("[role=dialog]")).not.toBeNull();

  await act(async () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  expect(onOpenChange).toHaveBeenCalledWith(false);
});
