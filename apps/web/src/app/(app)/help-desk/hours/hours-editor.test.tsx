import type { HelpdeskSchedule } from "@hackos/shared/help-desk";
import { getByLabelText, getByRole } from "@testing-library/dom";
import userEvent from "@testing-library/user-event";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { setEventTimeZone } from "@/lib/event-time";
import { HoursEditor } from "./hours-editor";

vi.mock("@/lib/api", () => ({ api: { put: vi.fn() }, ApiError: class extends Error {} }));
vi.mock("@/lib/i18n", () => ({
  useLocale: () => ({
    language: "en",
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key} ${JSON.stringify(values)}` : key,
  }),
}));
vi.mock("@/components/common/datetime-input", () => ({
  DateTimeInput: ({ onChange, ...props }: { onChange: (value: string) => void }) => (
    <input {...props} onChange={(event) => onChange(event.target.value)} />
  ),
}));
const first = { startsAt: "2027-02-27T10:00:00.000Z", endsAt: "2027-02-27T12:00:00.000Z" };
const second = { startsAt: "2027-02-27T14:00:00.000Z", endsAt: "2027-02-27T16:00:00.000Z" };
const base: HelpdeskSchedule = {
  configured: true,
  open: false,
  windows: [first, second],
  nextChangeAt: second.startsAt,
  suggestedInterval: { startsAt: "2027-02-26T09:00:00.000Z", endsAt: "2027-02-28T15:00:00.000Z" },
};
let root: Root, container: HTMLDivElement;
function Editor({ initial = base }: { initial?: HelpdeskSchedule }) {
  const [current, setCurrent] = useState(initial);
  return <HoursEditor schedule={current} onSaved={setCurrent} />;
}
beforeEach(() => {
  vi.clearAllMocks();
  setEventTimeZone("UTC");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
const dialog = () => getByRole(document.body, "dialog");
async function type(label: string, value: string) {
  const input = getByLabelText(dialog(), label) as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
describe("help desk hours (H64)", () => {
  it("shows the status with the next change and explains an empty schedule", async () => {
    await act(async () => root.render(<Editor />));
    expect(container.textContent).toContain("helpDeskHoursClosedNow");
    expect(container.textContent).toContain("helpDeskHoursOpens");
    await act(async () =>
      root.render(
        <Editor
          key="always"
          initial={{ ...base, configured: false, open: true, windows: [], nextChangeAt: null }}
        />,
      ),
    );
    expect(container.textContent).toContain("helpDeskHoursOpenNow");
    expect(container.textContent).toContain("helpDeskHoursEmpty");
  });
  it("adds a window prefilled from the hacking window as one complete sorted replacement", async () => {
    vi.mocked(api.put).mockImplementation(async (_path, body) => ({
      ...base,
      windows: (body as { windows: HelpdeskSchedule["windows"] }).windows,
    }));
    await act(async () => root.render(<Editor />));
    await act(async () =>
      userEvent.click(getByRole(container, "button", { name: "helpDeskHoursAdd" })),
    );
    expect((getByLabelText(dialog(), "helpDeskFrom") as HTMLInputElement).value).toBe(
      "2027-02-26T09:00",
    );
    await type("helpDeskTo", "2027-02-26T18:00");
    await act(async () =>
      userEvent.click(getByRole(dialog(), "button", { name: "helpDeskHoursAdd" })),
    );
    expect(api.put).toHaveBeenCalledWith("/api/helpdesk/schedule", {
      windows: [
        { startsAt: "2027-02-26T09:00:00.000Z", endsAt: "2027-02-26T18:00:00.000Z" },
        first,
        second,
      ],
    });
    expect(document.querySelector("[role=dialog]")).toBeNull();
  });
  it("refuses an overlapping or reversed window before calling the API", async () => {
    await act(async () => root.render(<Editor />));
    await act(async () =>
      userEvent.click(getByRole(container, "button", { name: "helpDeskHoursAdd" })),
    );
    await type("helpDeskFrom", "2027-02-27T11:00");
    await type("helpDeskTo", "2027-02-27T13:00");
    expect(dialog().textContent).toContain("helpDeskHoursOverlap");
    expect(
      getByRole(dialog(), "button", { name: "helpDeskHoursAdd" }).hasAttribute("disabled"),
    ).toBe(true);
    await type("helpDeskTo", "2027-02-27T10:30");
    expect(dialog().textContent).toContain("helpDeskIntervalOrder");
    expect(api.put).not.toHaveBeenCalled();
  });
  it("removes a window with the remaining ones, and an emptied schedule means always open", async () => {
    vi.mocked(api.put).mockResolvedValue({ ...base, windows: [second] });
    await act(async () => root.render(<Editor initial={{ ...base, windows: [first] }} />));
    await act(async () =>
      userEvent.click(
        container.querySelector<HTMLButtonElement>('button[aria-label^="helpDeskHoursRemove"]')!,
      ),
    );
    expect(api.put).toHaveBeenCalledWith("/api/helpdesk/schedule", { windows: [] });
  });
  it("keeps the dialog and shows the API error when saving fails", async () => {
    vi.mocked(api.put).mockRejectedValue(new Error("Offline"));
    await act(async () => root.render(<Editor />));
    await act(async () =>
      userEvent.click(
        container.querySelector<HTMLButtonElement>('button[aria-label^="helpDeskHoursEdit"]')!,
      ),
    );
    await type("helpDeskTo", "2027-02-27T13:00");
    await act(async () => userEvent.click(getByRole(dialog(), "button", { name: "saveChanges" })));
    expect(dialog().textContent).toContain("helpDeskSaveError");
  });
});
