import userEvent from "@testing-library/user-event";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JudgingWindowTab } from "@/app/(app)/settings/event/judging-window-tab";
import { getQueueSettings, updateQueueSettings } from "@/lib/queue";

// H38, H34: the pre-call notice and called-too-long warning minutes are
// edited with the judging hours, in the category's one save.

vi.mock("@/lib/queue", () => ({ getQueueSettings: vi.fn(), updateQueueSettings: vi.fn() }));
vi.mock("@/lib/api", () => ({ ApiError: class ApiError extends Error {} }));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/common/datetime-input", () => ({ DateTimeInput: () => null }));
const t = (key: string, values?: Record<string, string | number>) =>
  values ? Object.entries(values).reduce((s, [k, v]) => s.replace(`{${k}}`, String(v)), key) : key;
vi.mock("@/lib/i18n", () => ({ useLocale: () => ({ t }) }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const settings = {
  id: 1,
  handoff_buffer_minutes: 5,
  schedule_start_at: null,
  schedule_end_at: null,
  pre_call_notification_eta_minutes: 10,
  called_too_long_threshold_minutes: 10,
  requeue_prompt_default: "ask" as const,
};

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.mocked(getQueueSettings).mockResolvedValue(settings);
  vi.mocked(updateQueueSettings).mockImplementation(async (body) => ({
    ...settings,
    pre_call_notification_eta_minutes:
      body.preCallNotificationEtaMinutes ?? settings.pre_call_notification_eta_minutes,
    called_too_long_threshold_minutes:
      body.calledTooLongThresholdMinutes ?? settings.called_too_long_threshold_minutes,
  }));
  await act(async () => {
    root.render(<JudgingWindowTab />);
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.resetAllMocks();
});

const input = (label: string) =>
  [...container.querySelectorAll("label")]
    .find((l) => l.textContent === label)
    ?.closest("div")
    ?.querySelector("input") as HTMLInputElement;
const save = () =>
  [...container.querySelectorAll("button")].find((b) => b.textContent === "saveChanges") as
    | HTMLButtonElement
    | undefined;

describe("JudgingWindowTab timings", () => {
  it("loads both minute values and saves them with the judging hours", async () => {
    const user = userEvent.setup();
    const preCall = input("judgingPreCallMinutes");
    const tooLong = input("judgingCalledTooLongMinutes");
    expect(preCall.value).toBe("10");
    expect(tooLong.value).toBe("10");

    await act(async () => user.clear(preCall));
    await act(async () => user.type(preCall, "20"));
    await act(async () => user.clear(tooLong));
    await act(async () => user.type(tooLong, "25"));
    await act(async () => user.click(save() as HTMLButtonElement));
    expect(updateQueueSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        preCallNotificationEtaMinutes: 20,
        calledTooLongThresholdMinutes: 25,
      }),
    );
  });

  it("shows the range inline and does not save an out-of-range value", async () => {
    const user = userEvent.setup();
    const tooLong = input("judgingCalledTooLongMinutes");
    await act(async () => user.clear(tooLong));
    await act(async () => user.type(tooLong, "0"));
    await act(async () => user.click(save() as HTMLButtonElement));
    expect(container.textContent).toContain("timingRangeError");
    expect(updateQueueSettings).not.toHaveBeenCalled();
  });
});
