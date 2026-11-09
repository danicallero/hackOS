import { getByRole } from "@testing-library/dom";
import userEvent from "@testing-library/user-event";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RequestEditor } from "./request-editor";

vi.mock("@/lib/i18n", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
vi.mock("./request-form", () => ({
  RequestForm: ({
    onDirtyChange,
    onPendingChange,
  }: {
    onDirtyChange: (dirty: boolean) => void;
    onPendingChange: (pending: boolean) => void;
  }) => (
    <>
      <label>
        Need
        <input onChange={() => onDirtyChange(true)} />
      </label>
      <button type="button" onClick={() => onPendingChange(true)}>
        Send pending
      </button>
    </>
  ),
}));
let root: Root, container: HTMLDivElement;
function Editor() {
  const [open, setOpen] = useState(true);
  return <RequestEditor open={open} onOpenChange={setOpen} onSaved={vi.fn()} />;
}
beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
it("keeps the draft and restores the editor after cancelling discard, then closes on explicit discard (H64)", async () => {
  await act(async () => root.render(<Editor />));
  await act(async () =>
    userEvent.type(getByRole(document.body, "textbox", { name: "Need" }), "Debug model"),
  );
  await act(async () => userEvent.click(getByRole(document.body, "button", { name: "close" })));
  await act(async () =>
    userEvent.click(getByRole(document.body, "button", { name: "keepEditing" })),
  );
  expect((getByRole(document.body, "textbox", { name: "Need" }) as HTMLInputElement).value).toBe(
    "Debug model",
  );
  expect(document.querySelector("[role=alertdialog]")).toBeNull();
  await act(async () => userEvent.click(getByRole(document.body, "button", { name: "close" })));
  await act(async () =>
    userEvent.click(getByRole(document.body, "button", { name: "discardLibraryChanges" })),
  );
  expect(document.querySelector("[role=dialog]")).toBeNull();
});
it("does not dismiss an editor while its write is pending", async () => {
  await act(async () => root.render(<Editor />));
  await act(async () =>
    userEvent.click(getByRole(document.body, "button", { name: "Send pending" })),
  );
  await act(async () => userEvent.click(getByRole(document.body, "button", { name: "close" })));
  expect(getByRole(document.body, "dialog")).toBeDefined();
  expect(document.querySelector("[role=alertdialog]")).toBeNull();
});
