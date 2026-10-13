import userEvent from "@testing-library/user-event";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { NotificationsTab } from "./notifications-tab";

// H45, H51: the automatic schedule reminder's switch and lead are event
// settings sharing the category's one save (R011).

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), put: vi.fn() },
  ApiError: class ApiError extends Error {},
}));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const t = (key: string, values?: Record<string, string | number>) =>
  values ? Object.entries(values).reduce((s, [k, v]) => s.replace(`{${k}}`, String(v)), key) : key;
vi.mock("@/lib/i18n", () => ({ useLocale: () => ({ t }) }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
class StubResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as typeof globalThis & { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
  StubResizeObserver as unknown as typeof ResizeObserver;

const settings = (over: Record<string, unknown> = {}) => ({
  scheduleRemindersEnabled: true,
  scheduleReminderLeadMinutes: 15,
  defaultScheduleReminderLeadMinutes: 15,
  scheduleReminderLeadCustom: false,
  ...over,
});

let container: HTMLDivElement;
let root: Root;
let onDirtyChange: ReturnType<typeof vi.fn<(dirty: boolean) => void>>;

async function render() {
  await act(async () => {
    root.render(<NotificationsTab onDirtyChange={onDirtyChange} />);
  });
}

function button(label: string): HTMLButtonElement {
  const match = [...container.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === label || b.getAttribute("aria-label") === label,
  );
  if (!match) throw new Error(`no button "${label}"`);
  return match;
}

const lastPutBody = () => vi.mocked(api.put).mock.calls.at(-1)?.[1] as Record<string, unknown>;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  onDirtyChange = vi.fn<(dirty: boolean) => void>();
  vi.mocked(api.get).mockImplementation(() => Promise.resolve(settings()));
  vi.mocked(api.put).mockImplementation((_path: string, body: unknown) => {
    const b = body as { scheduleRemindersEnabled: boolean; scheduleReminderLeadMinutes?: number };
    return Promise.resolve(
      settings({
        scheduleRemindersEnabled: b.scheduleRemindersEnabled,
        scheduleReminderLeadMinutes: b.scheduleReminderLeadMinutes ?? 15,
        scheduleReminderLeadCustom: (b.scheduleReminderLeadMinutes ?? 15) !== 15,
      }),
    );
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.mocked(api.put).mockReset();
  vi.mocked(api.get).mockReset();
});

describe("NotificationsTab", () => {
  it("starts saved with the switch on and the default lead", async () => {
    await render();
    const input = container.querySelector<HTMLInputElement>("#schedule-reminder-lead");
    expect(input?.value).toBe("15");
    expect(container.textContent).not.toContain("liveActivitiesLeadReset");
    expect(button("saveChanges").disabled).toBe(true);
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it("edits the lead, validates its range inline, saves once and resets", async () => {
    const user = userEvent.setup();
    await render();
    const input = container.querySelector<HTMLInputElement>("#schedule-reminder-lead");

    await act(async () => user.clear(input as HTMLInputElement));
    await act(async () => user.type(input as HTMLInputElement, "0"));
    expect(input?.getAttribute("aria-invalid")).toBe("true");
    expect(container.textContent).toContain("timingRangeError");
    expect(button("saveChanges").disabled).toBe(true);

    await act(async () => user.clear(input as HTMLInputElement));
    await act(async () => user.type(input as HTMLInputElement, "30"));
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    await act(async () => user.click(button("saveChanges")));
    expect(api.put).toHaveBeenCalledTimes(1);
    expect(api.put).toHaveBeenCalledWith("/api/notifications/automation", {
      scheduleRemindersEnabled: true,
      scheduleReminderLeadMinutes: 30,
    });
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);

    await act(async () => user.click(button("liveActivitiesLeadReset")));
    expect(input?.value).toBe("15");
    await act(async () => user.click(button("saveChanges")));
    expect(lastPutBody().scheduleReminderLeadMinutes).toBe(15);
  });

  it("switches the reminders off, hides the lead and saves the switch", async () => {
    const user = userEvent.setup();
    await render();
    await act(async () =>
      user.click(container.querySelector("#schedule-reminders-enabled") as Element),
    );
    expect(container.querySelector("#schedule-reminder-lead")).toBeNull();
    await act(async () => user.click(button("saveChanges")));
    expect(lastPutBody()).toEqual({
      scheduleRemindersEnabled: false,
      scheduleReminderLeadMinutes: 15,
    });
  });

  it("shows a retryable error when the settings cannot load", async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockRejectedValueOnce(new Error("down"));
    await render();
    expect(container.textContent).toContain("couldNotLoadNotificationSettings");
    await act(async () => user.click(button("retry")));
    expect(container.querySelector("#schedule-reminder-lead")).not.toBeNull();
  });
});
