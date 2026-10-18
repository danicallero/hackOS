import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { AlertModal } from "./alert-modal";

vi.mock("@/lib/i18n", () => ({
  useLocale: () => ({ t: (key: string) => key }),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

it("keeps Cancel enabled while the confirmation is disabled", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <AlertModal
        open
        title="Return"
        description="Say why"
        cancelLabel="Cancel"
        confirmLabel="Confirm"
        confirmDisabled
        onConfirm={() => undefined}
      />,
    );
  });
  const button = (name: string) =>
    [...document.querySelectorAll("button")].find((node) => node.textContent === name);
  expect(button("Confirm")?.disabled).toBe(true);
  expect(button("Cancel")?.disabled).toBe(false);
  await act(async () => root.unmount());
  container.remove();
});
