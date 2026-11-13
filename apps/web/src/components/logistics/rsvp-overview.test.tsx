import userEvent from "@testing-library/user-event";
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ get: vi.fn(), schedule: vi.fn() }));
vi.mock("@/lib/i18n", () => ({ useLocale: () => ({ t: (k: string) => k, language: "es" }) }));
vi.mock("@/lib/api", () => ({ api: { get: mocks.get } }));
vi.mock("@/lib/logistics", () => ({
  logisticsApi: { schedule: mocks.schedule },
  resolveScheduleText: (item: { title: string }) => ({ title: item.title }),
}));
vi.mock("@/hooks/use-server-resource", () => ({
  useServerResource: (key: unknown[], fetcher: (s: AbortSignal) => Promise<unknown>) => {
    const [data, setData] = useState<unknown>(null);
    const k = JSON.stringify(key);
    // biome-ignore lint/correctness/useExhaustiveDependencies: key identifies the resource.
    useEffect(() => {
      void fetcher(new AbortController().signal).then(setData);
    }, [k]);
    return { data, error: null, loading: !data, reload: () => undefined, mutate: setData };
  },
}));

import { DietaryOverview } from "@/components/logistics/dietary-overview";
import { RsvpOverview } from "@/components/logistics/rsvp-overview";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;
const mount = async (node: React.ReactNode) => {
  await act(async () => root.render(node));
  await act(async () => undefined);
};
const click = async (text: RegExp) => {
  const el = [...container.querySelectorAll("button")].find((b) => text.test(b.textContent ?? ""));
  if (!el) throw new Error(`no button ${text}`);
  await act(async () => el.click());
};

beforeEach(() => {
  mocks.get.mockReset();
  mocks.schedule.mockResolvedValue({
    items: [
      { id: 1, title: "Comida sábado", startsAt: "2026-11-14T12:00:00Z" },
      { id: 2, title: "Acto de apertura", startsAt: "2026-11-13T09:00:00Z" },
    ],
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const counts = { attending: 1, notAttending: 0, unsure: 0, unanswered: 1 };

describe("RsvpOverview", () => {
  it("lists only the schedule entries marked as asking attendance, in time order", async () => {
    mocks.get.mockImplementation(async (path: string) => {
      if (path === "/api/logistics/rsvps")
        return {
          activities: [{ activityId: 9, scheduleId: 1, name: "Comida", ...counts }],
        };
      return { people: [] };
    });
    await mount(<RsvpOverview />);
    const rows = [...container.querySelectorAll("li > button")].map((b) => b.textContent);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("Comida sábado");
    expect(rows[0]).toContain("rsvpYes1");
    expect(container.textContent).not.toContain("Acto de apertura");
  });

  it("shows an empty state when no activity is asking attendance", async () => {
    mocks.get.mockResolvedValue({ activities: [] });
    await mount(<RsvpOverview />);
    expect(container.textContent).toContain("rsvpNoAskedActivities");
  });

  it("shows who said yes and lets the organizer filter answers when expanded", async () => {
    mocks.get.mockImplementation(async (path: string) => {
      if (path === "/api/logistics/rsvps")
        return {
          activities: [{ activityId: 9, scheduleId: 1, name: "Comida", ...counts }],
        };
      return {
        people: [
          {
            userId: 1,
            name: "Ana",
            surname: "Sí",
            kind: "sponsor",
            enterprise: "Acme",
            state: "yes",
          },
          {
            userId: 2,
            name: "Bea",
            surname: "Nada",
            kind: "mentor",
            enterprise: null,
            state: "unanswered",
          },
        ],
      };
    });
    await mount(<RsvpOverview />);
    await click(/Comida sábado/);
    expect(container.textContent).toContain("Ana Sí");
    expect(container.textContent).not.toContain("Bea Nada");
    const filter = [...container.querySelectorAll("fieldset button")].find((b) =>
      /rsvpUnanswered/.test(b.textContent ?? ""),
    ) as HTMLButtonElement;
    await act(async () => filter.click());
    expect(container.textContent).toContain("Bea Nada");
  });
});

describe("DietaryOverview search", () => {
  it("finds attendees without case or accent sensitivity", async () => {
    mocks.get.mockResolvedValue({
      people: 2,
      withRestrictions: 0,
      withNotes: 0,
      byIntolerance: [],
      entries: [
        {
          userId: 1,
          name: "José",
          surname: "Núñez",
          kind: "participant",
          enterprise: null,
          intolerances: [],
          notes: null,
        },
        {
          userId: 2,
          name: "Ana",
          surname: "Other",
          kind: "participant",
          enterprise: null,
          intolerances: [],
          notes: null,
        },
      ],
    });
    await mount(<DietaryOverview />);
    const search = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    await act(async () => userEvent.setup().type(search, "JOSE nunez"));
    expect(container.textContent).toContain("José Núñez");
    expect(container.textContent).not.toContain("Ana Other");
  });
});

describe("DietaryOverview", () => {
  it("filters by intolerance and searches names, intolerances and notes", async () => {
    mocks.get.mockResolvedValue({
      people: 5,
      withRestrictions: 1,
      withNotes: 2,
      byIntolerance: [{ id: 1, label: { es: "Gluten" }, n: 1 }],
      entries: [
        {
          userId: 1,
          name: "Ana",
          surname: "Celíaca",
          kind: "participant",
          enterprise: null,
          intolerances: [{ id: 1, label: { es: "Gluten" } }],
          notes: "sin trazas",
        },
        {
          userId: 2,
          name: "Beto",
          surname: "Kiwi",
          kind: "sponsor",
          enterprise: "Acme",
          intolerances: [],
          notes: "alergia al kiwi",
        },
      ],
    });
    await mount(<DietaryOverview />);
    expect(container.textContent).toContain("sin trazas");
    expect(container.textContent).toContain("alergia al kiwi");
    await click(/Gluten · 1/);
    expect(container.textContent).toContain("Ana Celíaca");
    expect(container.textContent).not.toContain("Beto Kiwi");
  });
});
