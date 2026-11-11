import type { HelpdeskSchedule } from "@hackos/shared/help-desk";
import { getByLabelText, getByRole } from "@testing-library/dom";
import userEvent from "@testing-library/user-event";
import { act, useState } from "react";
import type { Root } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { dialog, first, second, setupMountedRoot, typeInto } from "../dialog-test-utils";
import { HoursEditor } from "./hours-editor";

vi.mock("@/lib/api", async () => (await import("../dialog-test-utils")).apiMock);
vi.mock("@/lib/i18n", async () => (await import("../dialog-test-utils")).i18nMock);
vi.mock(
  "@/components/common/datetime-input",
  async () => (await import("../dialog-test-utils")).dateTimeInputMock,
);
const base: HelpdeskSchedule = {
  eventAccessOnly: true,
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
setupMountedRoot((mountedRoot, mountedContainer) => {
  root = mountedRoot;
  container = mountedContainer;
});
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
  it("adds a window prefilled after the last one as one complete sorted replacement", async () => {
    vi.mocked(api.put).mockImplementation(async (_path, body) => ({
      ...base,
      windows: (body as { windows: HelpdeskSchedule["windows"] }).windows,
    }));
    await act(async () => root.render(<Editor />));
    await act(async () =>
      userEvent.click(getByRole(container, "button", { name: "helpDeskHoursAdd" })),
    );
    // The prefill starts after the last window so it never opens overlapping.
    expect((getByLabelText(dialog(), "helpDeskFrom") as HTMLInputElement).value).toBe(
      "2027-02-27T16:00",
    );
    await typeInto("helpDeskTo", "2027-02-27T18:00");
    await act(async () =>
      userEvent.click(getByRole(dialog(), "button", { name: "helpDeskHoursAdd" })),
    );
    expect(api.put).toHaveBeenCalledWith("/api/helpdesk/schedule", {
      windows: [
        first,
        second,
        { startsAt: "2027-02-27T16:00:00.000Z", endsAt: "2027-02-27T18:00:00.000Z" },
      ],
      eventAccessOnly: true,
    });
    expect(document.querySelector("[role=dialog]")).toBeNull();
  });
  it("draws daily sliders and permits opening windows longer than 24 hours", async () => {
    vi.mocked(api.put).mockResolvedValue(base);
    await act(async () =>
      root.render(<Editor initial={{ ...base, windows: [], configured: false }} />),
    );
    const tracks = [...container.querySelectorAll<HTMLElement>("[data-track]")];
    expect(tracks).toHaveLength(3);
    tracks.forEach((track, row) => {
      track.getBoundingClientRect = () =>
        ({
          left: 0,
          width: 2400,
          top: row * 60,
          height: 40,
          right: 2400,
          bottom: row * 60 + 40,
        }) as DOMRect;
    });
    const fieldset = container.querySelector("fieldset")!;
    const fire = (target: Element, type: string, row: number) =>
      act(async () => {
        target.dispatchEvent(
          new MouseEvent(type, { bubbles: true, clientX: 1000, clientY: row * 60 + 20, button: 0 }),
        );
      });
    await fire(tracks[0], "pointerdown", 0);
    await fire(fieldset, "pointermove", 2);
    await fire(fieldset, "pointerup", 2);
    expect(api.put).toHaveBeenCalledWith("/api/helpdesk/schedule", {
      windows: [{ startsAt: "2027-02-26T10:00:00.000Z", endsAt: "2027-02-28T10:00:00.000Z" }],
      eventAccessOnly: true,
    });
  });

  it("refuses an overlapping or reversed window before calling the API", async () => {
    await act(async () => root.render(<Editor />));
    await act(async () =>
      userEvent.click(getByRole(container, "button", { name: "helpDeskHoursAdd" })),
    );
    await typeInto("helpDeskFrom", "2027-02-27T11:00");
    await typeInto("helpDeskTo", "2027-02-27T13:00");
    expect(dialog().textContent).toContain("helpDeskHoursOverlap");
    expect(
      getByRole(dialog(), "button", { name: "helpDeskHoursAdd" }).hasAttribute("disabled"),
    ).toBe(true);
    await typeInto("helpDeskTo", "2027-02-27T10:30");
    expect(dialog().textContent).toContain("helpDeskIntervalOrder");
    expect(api.put).not.toHaveBeenCalled();
  });
  it("removes a window with the remaining ones, and an emptied schedule means always open", async () => {
    vi.mocked(api.put).mockResolvedValue({ ...base, windows: [second] });
    await act(async () => root.render(<Editor initial={{ ...base, windows: [first] }} />));
    await act(async () =>
      userEvent.click(
        container.querySelector<HTMLButtonElement>('button[aria-label^="helpDeskEditInterval "]')!,
      ),
    );
    await act(async () => userEvent.click(getByRole(dialog(), "button", { name: "remove" })));
    expect(api.put).toHaveBeenCalledWith("/api/helpdesk/schedule", {
      windows: [],
      eventAccessOnly: true,
    });
  });
  it("lets the organizer open requests to people without event access", async () => {
    vi.mocked(api.put).mockResolvedValue(base);
    await act(async () => root.render(<Editor />));
    await act(async () =>
      container.querySelector<HTMLButtonElement>("button[role=switch]")?.click(),
    );
    expect(api.put).toHaveBeenCalledWith("/api/helpdesk/schedule", {
      windows: base.windows,
      eventAccessOnly: false,
    });
  });
  it("keeps the dialog and shows the API error when saving fails", async () => {
    vi.mocked(api.put).mockRejectedValue(new Error("Offline"));
    await act(async () => root.render(<Editor />));
    await act(async () =>
      userEvent.click(
        container.querySelector<HTMLButtonElement>('button[aria-label^="helpDeskEditInterval "]')!,
      ),
    );
    await typeInto("helpDeskTo", "2027-02-27T13:00");
    await act(async () => userEvent.click(getByRole(dialog(), "button", { name: "saveChanges" })));
    expect(dialog().textContent).toContain("helpDeskSaveError");
  });
});
