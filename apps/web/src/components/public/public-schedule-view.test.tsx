import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rsvps: [] as { activityId: number; answer: string | null }[],
  me: { id: 7, hasEventAccess: true } as Record<string, unknown> | null,
}));
const locale = { t: (key: string) => key, language: "en" };
vi.mock("@/lib/i18n", () => ({ useLocale: () => locale }));
vi.mock("@/lib/session", () => ({ useSessionContext: () => ({ me: mocks.me }) }));
vi.mock("@/hooks/use-rsvps", () => ({ useRsvps: () => ({ items: mocks.rsvps }) }));
vi.mock("@/lib/public-content", () => ({
  getPublicEvent: async () => ({ timezone: "Europe/Madrid" }),
}));
vi.mock("@/lib/logistics", () => ({
  logisticsApi: {
    viewerSchedule: async () => ({
      items: [
        { id: 1, title: "Opening", location: null, type: "activity", audiences: [] },
        { id: 2, title: "Workshop", location: null, type: "workshop", audiences: [] },
        { id: 3, title: "Dinner", location: null, type: "meal", audiences: [] },
      ],
    }),
  },
  resolveScheduleText: () => ({}),
}));
vi.mock("@/components/common/list-toolbar", () => ({
  ListToolbar: ({
    filters,
  }: {
    filters: { id: string; label: string; onChange: (v: string[]) => void }[];
  }) => (
    <div>
      {filters.map((filter) => (
        <button key={filter.id} type="button" onClick={() => filter.onChange(["yes"])}>
          {`filter:${filter.id}`}
        </button>
      ))}
    </div>
  ),
}));
vi.mock("@/components/public/schedule-timeline", () => ({
  ScheduleTimeline: ({
    items,
    renderToolbar,
  }: {
    items: { id: number; title: string }[];
    renderToolbar: (controls: null) => React.ReactNode;
  }) => (
    <div>
      {renderToolbar(null)}
      <ul>
        {items.map((item) => (
          <li key={item.id}>{item.title}</li>
        ))}
      </ul>
    </div>
  ),
}));

import { PublicScheduleView } from "@/components/public/public-schedule-view";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;
const render = async () => {
  await act(async () => root.render(<PublicScheduleView />));
  await act(async () => undefined);
};
const titles = () => [...container.querySelectorAll("li")].map((li) => li.textContent);

beforeEach(() => {
  mocks.rsvps = [];
  mocks.me = { id: 7, hasEventAccess: true };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("PublicScheduleView attendance filter", () => {
  it("offers no attendance filter until the person has answered an activity", async () => {
    mocks.rsvps = [{ activityId: 1, answer: null }];
    await render();
    expect(container.textContent).not.toContain("filter:attendance");
  });

  it("narrows the schedule to the activities the person said they will attend", async () => {
    mocks.rsvps = [
      { activityId: 2, answer: "yes" },
      { activityId: 3, answer: "no" },
    ];
    await render();
    expect(titles()).toEqual(["Opening", "Workshop", "Dinner"]);
    await act(async () =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "filter:attendance")
        ?.click(),
    );
    expect(titles()).toEqual(["Workshop"]);
  });
});
