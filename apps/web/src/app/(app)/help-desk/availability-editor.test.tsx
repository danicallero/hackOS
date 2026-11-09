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
const profile = { availability: [first, second], suggestedInterval: null } as MyHelperProfile;
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
          initial={{ availability: [first], suggestedInterval: window } as MyHelperProfile}
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
});
