import { getByLabelText, getByRole } from "@testing-library/dom";
import userEvent from "@testing-library/user-event";
import { act, useState } from "react";
import type { Root } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { AvailabilityEditor } from "./availability-editor";
import { dialog, first, second, setupMountedRoot, typeInto } from "./dialog-test-utils";
import type { MyHelperProfile } from "./model";

vi.mock("@/lib/api", async () => (await import("./dialog-test-utils")).apiMock);
vi.mock("@/lib/i18n", async () => (await import("./dialog-test-utils")).i18nMock);
vi.mock(
  "@/components/common/datetime-input",
  async () => (await import("./dialog-test-utils")).dateTimeInputMock,
);
const profile = {
  availability: [first, second],
  suggestedInterval: null,
} as unknown as MyHelperProfile;
let root: Root, container: HTMLDivElement;
const saved = vi.fn();
function Editor({ initial = profile }: { initial?: MyHelperProfile }) {
  const [current, setCurrent] = useState(initial);
  return (
    <AvailabilityEditor
      profile={current}
      onSaved={(next) => {
        saved(next);
        setCurrent(next);
      }}
    />
  );
}
setupMountedRoot((mountedRoot, mountedContainer) => {
  root = mountedRoot;
  container = mountedContainer;
});
describe("availability replacement (H62)", () => {
  it("edits in one replacement, retains the old schedule on failure, then retries the same draft", async () => {
    vi.mocked(api.put).mockRejectedValueOnce(new Error("Offline"));
    await act(async () => root.render(<Editor />));
    await act(async () =>
      userEvent.click(
        container.querySelectorAll<HTMLButtonElement>(
          'button[aria-label^="helpDeskEditInterval "]',
        )[0],
      ),
    );
    await typeInto("helpDeskTo", "2027-02-27T13:00");
    await act(async () => userEvent.click(getByRole(dialog(), "button", { name: "saveChanges" })));
    expect(saved).not.toHaveBeenCalled();
    expect(container.textContent).toContain("10:00 AM–12:00 PM");
    expect((getByLabelText(dialog(), "helpDeskTo") as HTMLInputElement).value).toBe(
      "2027-02-27T13:00",
    );
    const edited = { ...first, endsAt: "2027-02-27T13:00:00.000Z" };
    expect(api.put).toHaveBeenLastCalledWith("/api/me/helper-profile/availability", {
      intervals: [edited, second],
    });
    vi.mocked(api.put).mockResolvedValue({ ...profile, availability: [edited, second] });
    await act(async () => userEvent.click(getByRole(dialog(), "button", { name: "saveChanges" })));
    expect(saved).toHaveBeenCalledOnce();
    expect(document.querySelector("[role=dialog]")).toBeNull();
    expect(container.textContent).toContain("10:00 AM–01:00 PM");
  });
  it("prefills only the first 24 hours of a 36 hour hacking window", async () => {
    const initial = {
      ...profile,
      availability: [],
      suggestedInterval: { startsAt: first.startsAt, endsAt: "2027-02-28T22:00:00.000Z" },
    };
    await act(async () => root.render(<Editor initial={initial} />));
    await act(async () =>
      userEvent.click(getByRole(container, "button", { name: "helpDeskAddInterval" })),
    );
    expect((getByLabelText(dialog(), "helpDeskTo") as HTMLInputElement).value).toBe(
      "2027-02-28T10:00",
    );
    vi.mocked(api.put).mockResolvedValue(profile);
    await act(async () =>
      userEvent.click(getByRole(dialog(), "button", { name: "helpDeskAddInterval" })),
    );
    expect(api.put).toHaveBeenCalledWith("/api/me/helper-profile/availability", {
      intervals: [{ startsAt: first.startsAt, endsAt: "2027-02-28T10:00:00.000Z" }],
    });
  });
  it("refuses overlap with another interval while allowing the interval being edited", async () => {
    await act(async () => root.render(<Editor />));
    const edit = container.querySelectorAll(
      'button[aria-label^="helpDeskEditInterval "]',
    )[0] as HTMLButtonElement;
    await act(async () => userEvent.click(edit));
    expect(getByRole(dialog(), "button", { name: "saveChanges" }).hasAttribute("disabled")).toBe(
      false,
    );
    await typeInto("helpDeskTo", "2027-02-27T15:00");
    expect(dialog().textContent).toContain("helpDeskIntervalOverlap");
    expect(getByRole(dialog(), "button", { name: "saveChanges" }).hasAttribute("disabled")).toBe(
      true,
    );
    expect(api.put).not.toHaveBeenCalled();
  });
  it("lists every hacking day and prefills the add dialog on the chosen day", async () => {
    const window = { startsAt: "2027-02-26T09:00:00.000Z", endsAt: "2027-02-28T15:00:00.000Z" };
    await act(async () => {
      root.render(
        <Editor
          initial={
            { availability: [first], suggestedInterval: window } as unknown as MyHelperProfile
          }
        />,
      );
    });
    const add = Array.from(container.querySelectorAll("button")).filter((button) =>
      button.getAttribute("aria-label")?.startsWith("helpDeskAddIntervalOn"),
    );
    expect(add).toHaveLength(3);
    await act(async () => add[2].click());
    expect((getByLabelText(dialog(), "helpDeskFrom") as HTMLInputElement).value).toBe(
      "2027-02-28T09:00",
    );
  });

  /** Day lines 2400 px wide (100 px per hour), 60 px apart; the test fires their pointer events. */
  function timeline() {
    const tracks = [...container.querySelectorAll<HTMLElement>("[data-track]")];
    for (const [row, track] of tracks.entries()) {
      track.getBoundingClientRect = () =>
        ({
          left: 0,
          width: 2400,
          top: row * 60,
          height: 40,
          right: 2400,
          bottom: row * 60 + 40,
          x: 0,
          y: row * 60,
        }) as DOMRect;
    }
    const lines = container.querySelector("fieldset") as HTMLFieldSetElement;
    lines.setPointerCapture = () => undefined;
    lines.releasePointerCapture = () => undefined;
    const fire = (target: Element, type: string, row: number, x: number) =>
      act(async () => {
        target.dispatchEvent(
          new MouseEvent(type, { bubbles: true, clientX: x, clientY: row * 60 + 20, button: 0 }),
        );
      });
    return {
      tracks,
      press: (row: number, x: number) => fire(tracks[row], "pointerdown", row, x),
      move: (row: number, x: number) => fire(lines, "pointermove", row, x),
      release: (row: number, x: number) => fire(lines, "pointerup", row, x),
    };
  }
  const window = { startsAt: "2027-02-26T09:00:00.000Z", endsAt: "2027-02-28T15:00:00.000Z" };
  const withWindow = (availability: unknown[]) =>
    ({ availability, suggestedInterval: window }) as unknown as MyHelperProfile;
  const iso = (day: number, hour: number, minute = 0) =>
    `2027-02-${day}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`;
  const expectSaved = (intervals: { startsAt: string; endsAt: string }[]) =>
    expect(api.put).toHaveBeenCalledWith("/api/me/helper-profile/availability", { intervals });

  it("marks a stretch by dragging across a day line and saves the replacement", async () => {
    vi.mocked(api.put).mockResolvedValue(withWindow([]));
    await act(async () => root.render(<Editor initial={withWindow([])} />));
    const lines = timeline();
    await lines.press(1, 1000);
    await lines.move(1, 1250);
    await lines.release(1, 1250);
    expectSaved([{ startsAt: iso(27, 10), endsAt: iso(27, 12, 30) }]);
  });

  it("marks a stretch across midnight by dragging onto the next day line", async () => {
    vi.mocked(api.put).mockResolvedValue(
      withWindow([{ startsAt: iso(27, 21), endsAt: iso(28, 3) }]),
    );
    await act(async () => root.render(<Editor initial={withWindow([])} />));
    const lines = timeline();
    await lines.press(1, 2100);
    await lines.move(2, 300);
    await lines.release(2, 300);
    expectSaved([{ startsAt: iso(27, 21), endsAt: iso(28, 3) }]);
    expect(container.textContent).toContain("09:00 PM–03:00 AM");
  });

  it("keeps a new stretch from starting before hacking does", async () => {
    vi.mocked(api.put).mockResolvedValue(withWindow([]));
    await act(async () => root.render(<Editor initial={withWindow([])} />));
    const lines = timeline();
    await lines.press(0, 300);
    await lines.move(0, 1200);
    await lines.release(0, 1200);
    expectSaved([{ startsAt: iso(26, 9), endsAt: iso(26, 12) }]);
  });

  it("extends an overlapped stretch to cover the new one", async () => {
    const evening = { startsAt: iso(27, 8), endsAt: iso(27, 20) };
    vi.mocked(api.put).mockResolvedValue(withWindow([evening]));
    await act(async () => root.render(<Editor initial={withWindow([evening])} />));
    const lines = timeline();
    await lines.press(1, 1900);
    await lines.move(1, 2100);
    await lines.release(1, 2100);
    expectSaved([{ startsAt: iso(27, 8), endsAt: iso(27, 21) }]);
  });

  it("opens the add dialog for a plain press on an empty line", async () => {
    await act(async () => root.render(<Editor initial={withWindow([first])} />));
    const lines = timeline();
    await lines.press(0, 300);
    await lines.release(0, 300);
    expect(dialog()).toBeTruthy();
  });

  /** Drags the marked stretch (10:00-12:00, 1000-1200 px on the second line) from `from` to `to` px. */
  async function dragSegment(from: number, to: number, toRow = 1) {
    const lines = timeline();
    const segment = container.querySelector<HTMLElement>(
      'button[aria-label^="helpDeskEditInterval "]',
    ) as HTMLElement;
    segment.getBoundingClientRect = () =>
      ({
        left: 1000,
        width: 200,
        top: 60,
        height: 40,
        right: 1200,
        bottom: 100,
        x: 1000,
        y: 60,
      }) as DOMRect;
    await act(async () => {
      segment.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, clientX: from, clientY: 80, button: 0 }),
      );
    });
    await lines.move(toRow, to);
    await lines.release(toRow, to);
  }

  it("changes the end of a stretch by dragging its right edge", async () => {
    vi.mocked(api.put).mockResolvedValue(withWindow([first]));
    await act(async () => root.render(<Editor initial={withWindow([first])} />));
    await dragSegment(1195, 1300);
    expectSaved([{ startsAt: iso(27, 10), endsAt: iso(27, 13) }]);
  });

  it("moves a whole stretch by dragging its middle, onto the next day if dropped there", async () => {
    vi.mocked(api.put).mockResolvedValue(withWindow([first]));
    await act(async () => root.render(<Editor initial={withWindow([first])} />));
    await dragSegment(1100, 1200);
    expectSaved([{ startsAt: iso(27, 11), endsAt: iso(27, 13) }]);
  });

  it("opens the edit dialog when a stretch is pressed without dragging", async () => {
    await act(async () => root.render(<Editor initial={withWindow([first])} />));
    await dragSegment(1100, 1100);
    expect(dialog()).toBeTruthy();
    expect(api.put).not.toHaveBeenCalled();
  });

  it("shows a dropped stretch at once and puts it back if saving fails", async () => {
    let fail: (reason: Error) => void = () => undefined;
    vi.mocked(api.put).mockReturnValue(new Promise((_, reject) => (fail = reject)));
    await act(async () => root.render(<Editor initial={withWindow([first])} />));
    await dragSegment(1195, 1300);
    expect(container.textContent).toContain("10:00 AM–01:00 PM");
    await act(async () => fail(new Error("Offline")));
    expect(container.textContent).toContain("10:00 AM–12:00 PM");
  });
});
