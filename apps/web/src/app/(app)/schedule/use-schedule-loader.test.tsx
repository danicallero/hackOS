import { EVENTS, REALTIME_SCOPES } from "@hackos/shared/events";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicScheduleItem } from "@/lib/logistics";
import { useScheduleLoader } from "./use-schedule-loader";

const logistics = vi.hoisted(() => ({ schedule: vi.fn() }));
const liveRefresh = vi.hoisted(() => ({ value: 0, stream: "", events: [] as string[] }));
const translate = vi.hoisted(() => (key: string) => key);

vi.mock("@/lib/logistics", () => ({ logisticsApi: logistics }));
vi.mock("@/lib/api-error-text", () => ({
  apiErrorText: (_err: unknown, _t: unknown, fallback: string) => fallback,
}));
vi.mock("@/hooks/use-auto-refresh", () => ({
  useAutoRefresh: (stream: string, events: string[]) => {
    liveRefresh.stream = stream;
    liveRefresh.events = events;
    return liveRefresh.value;
  },
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const item = (title: string): PublicScheduleItem => ({
  id: 1,
  title,
  description: null,
  location: null,
  type: "activity",
  startsAt: "2026-10-13T10:00:00.000Z",
  endsAt: "2026-10-13T11:00:00.000Z",
  publishAt: null,
  primaryLanguage: "en",
  titleI18n: {},
  descriptionI18n: {},
});

function Harness() {
  const [items, setItems] = useState<PublicScheduleItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState(new Set<number>());
  const [editingItem, setEditingItem] = useState<PublicScheduleItem | null>(item("Old title"));
  useScheduleLoader({
    canRead: true,
    t: translate,
    setItems,
    setError,
    setSelectedIds,
    setEditingItem,
  });

  return (
    <div>
      <span data-testid="items">{items?.length ?? 0}</span>
      <span data-testid="error">{error ?? ""}</span>
      <span data-testid="selection">{[...selectedIds].join(",")}</span>
      <span data-testid="editing">{editingItem?.title ?? ""}</span>
      <button type="button" onClick={() => setSelectedIds(new Set([1, 2]))}>
        select
      </button>
    </div>
  );
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  logistics.schedule.mockReset();
  liveRefresh.value = 0;
  liveRefresh.stream = "";
  liveRefresh.events = [];
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("schedule live loader", () => {
  it("refreshes from content events and reconciles selection while updating an open item", async () => {
    logistics.schedule
      .mockResolvedValueOnce({ items: [item("Old title")] })
      .mockResolvedValueOnce({ items: [item("Updated title")] });

    await act(async () => root.render(<Harness />));
    expect(liveRefresh.stream).toBe(REALTIME_SCOPES.PUBLIC_CONTENT);
    expect(liveRefresh.events).toContain(EVENTS.DATA_CHANGED);
    await act(async () => {
      container.querySelector("button")?.click();
    });

    liveRefresh.value = 1;
    await act(async () => root.render(<Harness />));

    expect(container.querySelector('[data-testid="selection"]')?.textContent).toBe("1");
    expect(container.querySelector('[data-testid="editing"]')?.textContent).toBe("Updated title");
    expect(logistics.schedule).toHaveBeenCalledTimes(2);
  });
});
