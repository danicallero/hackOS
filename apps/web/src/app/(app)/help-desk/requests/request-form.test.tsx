import { getByLabelText, getByRole } from "@testing-library/dom";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import type { HelpRequest } from "../model";
import { RequestForm } from "./request-form";

vi.mock("@/lib/api", () => ({ api: { patch: vi.fn(), post: vi.fn() } }));
vi.mock("@/lib/i18n", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
vi.mock("@/hooks/use-server-resource", () => ({
  useServerResource: (key: string[]) => ({
    data:
      key[1] === "challenges"
        ? { challenges: [{ id: 5, name: "AI", mine: true }] }
        : { projects: [] },
    loading: false,
  }),
}));
vi.mock("../shared", () => ({
  HelpdeskError: () => null,
  TopicsPicker: () => <span>Topics</span>,
}));
const request = {
  id: 12,
  topics: [{ id: 3, name: "Frontend" }],
  other: false,
  challenge: { id: 5, name: "AI" },
  preferSponsor: true,
  description: "  Debug a model  ",
  location: "  Table 9  ",
} as HelpRequest;
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks();
  HTMLElement.prototype.hasPointerCapture ??= () => false;
  HTMLElement.prototype.releasePointerCapture ??= () => {};
  HTMLElement.prototype.scrollIntoView ??= () => {};
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
describe("request editing (H64/H65)", () => {
  it("warns about moving to the FIFO tail before saving and retains challenge sponsor preference", async () => {
    const onSaved = vi.fn();
    let complete: (value: unknown) => void = () => {};
    vi.mocked(api.patch).mockReturnValue(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    await act(async () => root.render(<RequestForm request={request} onSaved={onSaved} />));
    await act(async () => userEvent.type(getByLabelText(container, "helpDeskDescription"), " now"));
    await act(async () => userEvent.click(getByRole(container, "button", { name: "saveChanges" })));
    expect(api.patch).not.toHaveBeenCalled();
    const warning = getByRole(document.body, "alertdialog");
    expect(warning.textContent).toContain("helpDeskEditConfirm");
    await act(async () =>
      userEvent.click(getByRole(warning, "button", { name: "helpDeskEditAndMove" })),
    );
    expect(api.patch).toHaveBeenCalledExactlyOnceWith("/api/helpdesk/requests/12", {
      topicIds: [3],
      other: false,
      challengeId: 5,
      preferSponsor: true,
      description: "Debug a model   now",
      location: "Table 9",
    });
    expect(
      getByRole(warning, "button", { name: "helpDeskEditAndMove" }).hasAttribute("disabled"),
    ).toBe(true);
    expect(container.querySelector('[role="combobox"]')?.hasAttribute("disabled")).toBe(true);
    await act(async () => complete({}));
    expect(onSaved).toHaveBeenCalledOnce();
  });
  it("does not move an unchanged edit to the end of the queue", async () => {
    await act(async () => root.render(<RequestForm request={request} onSaved={vi.fn()} />));
    expect(getByRole(container, "button", { name: "saveChanges" }).hasAttribute("disabled")).toBe(
      true,
    );
    await act(async () => userEvent.click(getByRole(container, "button", { name: "saveChanges" })));
    expect(api.patch).not.toHaveBeenCalled();
    expect(document.querySelector("[role=alertdialog]")).toBeNull();
  });
  it("clears sponsor preference when the challenge is removed and allows cancelling the queue warning", async () => {
    await act(async () => root.render(<RequestForm request={request} onSaved={vi.fn()} />));
    await act(async () =>
      userEvent.click(getByRole(container, "combobox", { name: "helpDeskChallenge" })),
    );
    await act(async () =>
      userEvent.click(getByRole(document.body, "option", { name: "helpDeskNoChallenge" })),
    );
    const preference = getByRole(container, "switch");
    expect(preference.getAttribute("aria-checked")).toBe("false");
    expect(preference.hasAttribute("disabled")).toBe(true);
    await act(async () => userEvent.click(getByRole(container, "button", { name: "saveChanges" })));
    await act(async () =>
      userEvent.click(
        getByRole(getByRole(document.body, "alertdialog"), "button", { name: "cancel" }),
      ),
    );
    expect(api.patch).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
  });
});
