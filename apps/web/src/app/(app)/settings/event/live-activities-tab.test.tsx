import userEvent from "@testing-library/user-event";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { LiveActivitiesTab } from "./live-activities-tab";

// #966: the Live Activities category — priority is list order, every kind is
// sent exactly once, and all edits share the category's one save (R011).

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), put: vi.fn() },
  ApiError: class ApiError extends Error {},
}));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/settings/event",
  useSearchParams: () => new URLSearchParams(),
}));
let mobile = false;
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => mobile }));
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

const KINDS = ["activity", "attendee_activity", "queue", "deadline", "judging", "accreditation"];

function settings() {
  return {
    maxConcurrent: 2,
    roles,
    kinds: KINDS.map((kind, priority) => ({
      kind,
      enabled: true,
      priority,
      roleIds: kind === "activity" ? [1] : kind === "accreditation" ? [2, 1] : [],
      requiredCapability: kind === "activity" ? "meals:scan" : null,
    })),
  };
}

const roles = [
  { id: 1, name: "Staff" },
  { id: 2, name: "Participants" },
];

let container: HTMLDivElement;
let root: Root;
let onDirtyChange: ReturnType<typeof vi.fn<(dirty: boolean) => void>>;

async function render() {
  await act(async () => {
    root.render(<LiveActivitiesTab onDirtyChange={onDirtyChange} />);
  });
}

function button(label: string): HTMLButtonElement {
  const match = [...container.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === label || b.getAttribute("aria-label") === label,
  );
  if (!match) throw new Error(`no button "${label}"`);
  return match;
}

function rowButton(name: string): HTMLButtonElement {
  const match = [...container.querySelectorAll<HTMLButtonElement>("li button")].find(
    (b) => b.querySelector("span span")?.textContent === name,
  );
  if (!match) throw new Error(`no row "${name}"`);
  return match;
}

const rowNames = () =>
  [...container.querySelectorAll("ul[aria-label='liveActivitiesTitle'] li")].map(
    (li) => li.querySelector("span.font-medium, span.text-sm")?.textContent,
  );

const lastPutBody = () =>
  vi.mocked(api.put).mock.calls.at(-1)?.[1] as {
    maxConcurrent: number;
    kinds: { kind: string; enabled: boolean; roleIds: number[] }[];
  };

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  mobile = false;
  onDirtyChange = vi.fn<(dirty: boolean) => void>();
  vi.mocked(api.get).mockImplementation(() => Promise.resolve(settings()));
  vi.mocked(api.put).mockImplementation((_path: string, body: unknown) => {
    const b = body as ReturnType<typeof lastPutBody>;
    return Promise.resolve({
      maxConcurrent: b.maxConcurrent,
      roles,
      kinds: b.kinds.map((k, priority) => ({ ...k, priority, requiredCapability: null })),
    });
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.mocked(api.put).mockReset();
  vi.mocked(api.get).mockReset();
});

describe("LiveActivitiesTab", () => {
  it("lists every kind in priority order with its roles, and starts saved", async () => {
    await render();
    expect(rowNames()).toEqual([
      "liveActivityKindActivity",
      "liveActivityKindAttendeeActivity",
      "liveActivityKindQueue",
      "liveActivityKindDeadline",
      "liveActivityKindJudging",
      "liveActivityKindAccreditation",
    ]);
    expect(container.textContent).toContain("Staff");
    expect(container.textContent).toContain("liveActivityNoRoles");
    expect(container.textContent).toContain("liveActivityAllRoles");
    // The first kind's editor opens by default, with its required permission.
    expect(container.querySelector("h2")?.textContent).toBe("liveActivityKindActivity");
    expect(container.textContent).toContain("liveActivityRequiredPermission");
    expect(button("saveChanges").disabled).toBe(true);
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it("moves a kind down and sends the new order as priority", async () => {
    const user = userEvent.setup();
    await render();
    expect(button("moveUp").disabled).toBe(true);
    await act(async () => user.click(button("moveDown")));
    expect(rowNames()[0]).toBe("liveActivityKindAttendeeActivity");
    expect(rowNames()[1]).toBe("liveActivityKindActivity");
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);

    await act(async () => user.click(button("saveChanges")));
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.put).toHaveBeenCalledWith("/api/live-activities/settings", expect.anything());
    const body = lastPutBody();
    expect(body.kinds.map((k) => k.kind)).toEqual([
      "attendee_activity",
      "activity",
      "queue",
      "deadline",
      "judging",
      "accreditation",
    ]);
    expect(body.kinds[1]).toEqual({ kind: "activity", enabled: true, roleIds: [1] });
    expect(button("saveChanges").disabled).toBe(true);
  });

  it("disables a kind from its row switch", async () => {
    const user = userEvent.setup();
    await render();
    const rowSwitches = [...container.querySelectorAll("li button[role='switch']")];
    expect(rowSwitches).toHaveLength(KINDS.length);
    await act(async () => user.click(rowSwitches[2]));
    await act(async () => user.click(button("saveChanges")));
    const body = lastPutBody();
    expect(body.kinds.find((k) => k.kind === "queue")?.enabled).toBe(false);
    expect(body.kinds.filter((k) => k.enabled)).toHaveLength(5);
  });

  it("selects roles in a kind's editor and sends every kind exactly once", async () => {
    const user = userEvent.setup();
    await render();
    await act(async () => user.click(rowButton("liveActivityKindQueue")));
    expect(container.querySelector("h2")?.textContent).toBe("liveActivityKindQueue");
    const participants = container.querySelector<HTMLButtonElement>("#live-activity-queue-role-2");
    expect(participants).not.toBeNull();
    await act(async () => user.click(participants as HTMLButtonElement));
    await act(async () => user.click(button("saveChanges")));
    const body = lastPutBody();
    expect(body.kinds.find((k) => k.kind === "queue")?.roleIds).toEqual([2]);
    expect(new Set(body.kinds.map((k) => k.kind)).size).toBe(KINDS.length);
    expect(body.kinds).toHaveLength(KINDS.length);
    expect(body.maxConcurrent).toBe(2);
  });

  it("keeps the draft and reports an error when saving fails", async () => {
    const user = userEvent.setup();
    vi.mocked(api.put).mockRejectedValue(new Error("boom"));
    await render();
    await act(async () => user.click(button("moveDown")));
    await act(async () => user.click(button("saveChanges")));
    expect(container.textContent).toContain("saveStateError");
    expect(rowNames()[0]).toBe("liveActivityKindAttendeeActivity");
    expect(button("saveChanges").disabled).toBe(false);
  });

  it("shows a retryable error when the settings cannot load", async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockRejectedValueOnce(new Error("down"));
    await render();
    expect(container.textContent).toContain("couldNotLoadLiveActivities");
    await act(async () => user.click(button("retry")));
    expect(rowNames()).toHaveLength(KINDS.length);
  });

  it("drills down from the list into a kind on mobile", async () => {
    const user = userEvent.setup();
    mobile = true;
    await render();
    expect(container.querySelector("h2")).toBeNull();
    await act(async () => user.click(rowButton("liveActivityKindDeadline")));
    expect(container.querySelector("h2")?.textContent).toBe("liveActivityKindDeadline");
    expect(rowNames()).toHaveLength(0);
    await act(async () => user.click(button("liveActivitiesTitle")));
    expect(rowNames()).toHaveLength(KINDS.length);
  });
});
