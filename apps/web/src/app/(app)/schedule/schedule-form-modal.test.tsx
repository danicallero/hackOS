import userEvent from "@testing-library/user-event";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScheduleInput } from "@/lib/logistics";
import { cleanScheduleForm, EMPTY_SCHEDULE_FORM, ScheduleFormModal } from "./schedule-form-modal";

// #966: an activity with an audience can show that audience a Live Activity.

vi.mock("@/lib/logistics", () => ({
  logisticsApi: {
    scheduleTranslateAvailability: vi.fn().mockResolvedValue({ available: false }),
    saveScheduleTranslations: vi.fn(),
  },
}));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const t = (key: string) => key;
vi.mock("@/lib/i18n", () => ({ useLocale: () => ({ t, language: "en" }) }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
class StubResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as typeof globalThis & { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
  StubResizeObserver as unknown as typeof ResizeObserver;

const base: ScheduleInput = {
  ...EMPTY_SCHEDULE_FORM,
  title: "Workshop",
  startsAt: "2026-10-11T10:00",
  endsAt: "2026-10-11T11:00",
};

let container: HTMLDivElement;
let root: Root;
let onSubmit: ReturnType<typeof vi.fn<(values: ScheduleInput) => Promise<{ id: number }>>>;

async function render(initial: ScheduleInput) {
  await act(async () => {
    root.render(
      <ScheduleFormModal
        open
        onOpenChange={vi.fn()}
        title="edit"
        initial={initial}
        onSubmit={onSubmit}
      />,
    );
  });
}

const audienceSwitch = () => document.querySelector<HTMLButtonElement>("#live-activity-audience");

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  onSubmit = vi
    .fn<(values: ScheduleInput) => Promise<{ id: number }>>()
    .mockResolvedValue({ id: 1 });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("ScheduleFormModal Live Activity audience switch", () => {
  it("is hidden for a staff-only item", async () => {
    await render(base);
    expect(audienceSwitch()).toBeNull();
  });

  it("submits the audience Live Activity choice for an item with an audience", async () => {
    const user = userEvent.setup();
    await render({ ...base, audiences: ["participant"] });
    const toggle = audienceSwitch();
    expect(toggle?.getAttribute("aria-checked")).toBe("false");
    await act(async () => user.click(toggle as HTMLButtonElement));
    const save = [...document.querySelectorAll("button")].find((b) => b.textContent === "save");
    await act(async () => user.click(save as HTMLButtonElement));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ liveActivityAudience: true }),
      [],
    );
  });

  it("never sends it on for an item without an audience", () => {
    expect(cleanScheduleForm({ ...base, liveActivityAudience: true }).liveActivityAudience).toBe(
      false,
    );
    expect(
      cleanScheduleForm({ ...base, audiences: ["participant"], liveActivityAudience: true })
        .liveActivityAudience,
    ).toBe(true);
  });
});
