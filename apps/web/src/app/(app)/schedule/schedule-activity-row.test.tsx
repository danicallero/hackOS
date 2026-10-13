import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { logisticsApi, type PublicScheduleItem } from "@/lib/logistics";
import { ActivityRow } from "./schedule-activity-row";

// #966: the roster shows whether an entry displays a Live Activity, and
// schedule:manage holders toggle it inline like the scannable column.

vi.mock("@/lib/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/i18n")>()),
  useLocale: () => ({ t: (key: string) => key, language: "en" }),
}));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/logistics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/logistics")>();
  return { ...actual, logisticsApi: { ...actual.logisticsApi, updateSchedule: vi.fn() } };
});

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const LIVE_CHECKBOX = '[aria-label="scheduleLiveActivityColumn"]';

function makeItem(
  liveActivityAudience: boolean | undefined,
  audiences: PublicScheduleItem["audiences"] = ["participant"],
): PublicScheduleItem {
  return {
    id: 1,
    title: "Workshop",
    description: null,
    location: null,
    type: "workshop",
    requiresScan: false,
    startsAt: "2026-07-22T13:00:00.000Z",
    endsAt: "2026-07-22T14:00:00.000Z",
    visibility: "shown",
    publishAt: null,
    audiences,
    liveActivityAudience,
    primaryLanguage: "en",
    titleI18n: {},
    descriptionI18n: {},
  };
}

function mount(item: PublicScheduleItem, canEdit: boolean, onUpdate = vi.fn()) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <table>
        <tbody>
          <ActivityRow
            item={item}
            dayKey="2026-07-22"
            columns={["liveActivity"]}
            canEdit={canEdit}
            selected={false}
            onToggleSelected={() => {}}
            onUpdate={onUpdate}
            onOpenEdit={() => {}}
            onDuplicate={() => {}}
            onDelete={() => {}}
          />
        </tbody>
      </table>,
    );
  });
  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function renderCell(liveActivityAudience: boolean | undefined): string {
  const view = mount(makeItem(liveActivityAudience), false);
  const text = view.container.querySelector("td")?.textContent ?? "";
  view.unmount();
  return text;
}

describe("ActivityRow liveActivity column", () => {
  it("reads yes when the entry shows a Live Activity", () => {
    expect(renderCell(true)).toBe("yesLabel");
  });

  it("reads no otherwise, including when the field is absent", () => {
    expect(renderCell(false)).toBe("noLabel");
    expect(renderCell(undefined)).toBe("noLabel");
  });

  it("is a read-only text for schedule:read viewers", () => {
    const view = mount(makeItem(true), false);
    expect(view.container.querySelector(LIVE_CHECKBOX)).toBeNull();
    view.unmount();
  });

  it("toggles inline through the schedule PATCH for editors", async () => {
    const updated = makeItem(true);
    vi.mocked(logisticsApi.updateSchedule).mockResolvedValue(updated);
    const onUpdate = vi.fn();
    const view = mount(makeItem(false), true, onUpdate);
    const checkbox = view.container.querySelector<HTMLButtonElement>(LIVE_CHECKBOX);
    expect(checkbox?.getAttribute("aria-label")).toBe("scheduleLiveActivityColumn");
    expect(checkbox?.disabled).toBe(false);
    await act(async () => {
      checkbox?.click();
    });
    expect(logisticsApi.updateSchedule).toHaveBeenCalledWith(1, { liveActivityAudience: true });
    expect(onUpdate).toHaveBeenCalledWith(updated);
    view.unmount();
  });

  it("is disabled with a reason while the item has no audience", () => {
    const view = mount(makeItem(false, []), true);
    const checkbox = view.container.querySelector<HTMLButtonElement>(LIVE_CHECKBOX);
    expect(checkbox?.disabled).toBe(true);
    expect(checkbox?.closest("[title]")?.getAttribute("title")).toBe(
      "liveActivityRequiresAudience",
    );
    view.unmount();
  });
});
