import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import type { DirectoryEntry } from "./people-directory";

const navigation = vi.hoisted(() => ({
  search: "",
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => {
  const router = { replace: navigation.replace, push: vi.fn(), prefetch: vi.fn() };
  return {
    useRouter: () => router,
    usePathname: () => "/people",
    useSearchParams: () => new URLSearchParams(navigation.search),
  };
});

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

vi.mock("@/hooks/use-auto-refresh", () => ({ useAutoRefresh: () => 0 }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));

const t = (key: string, values?: Record<string, string | number>) =>
  values ? Object.entries(values).reduce((s, [k, v]) => s.replace(`{${k}}`, String(v)), key) : key;
vi.mock("@/lib/i18n", () => ({ useLocale: () => ({ t, language: "en" }) }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function entry(overrides: Partial<DirectoryEntry> = {}): DirectoryEntry {
  return {
    userId: 1,
    displayName: "Ana P.",
    photoUrl: null,
    headline: null,
    locationNote: null,
    project: null,
    challenges: [],
    ...overrides,
  };
}

let directory: { items: DirectoryEntry[]; nextCursor: string | null };
const get = vi.mocked(api.get);

let container: HTMLDivElement;
let root: Root;

async function render() {
  const { PeopleDirectory } = await import("./people-directory");
  await act(async () => {
    root.render(<PeopleDirectory />);
  });
}

beforeEach(() => {
  navigation.search = "";
  navigation.replace.mockReset();
  directory = { items: [], nextCursor: null };
  get.mockReset();
  get.mockImplementation(((path: string) =>
    Promise.resolve(
      path === "/api/public/challenges"
        ? { items: [{ id: 7, title: { en: "Best hack", es: "Mejor hack", gl: "Mellor hack" } }] }
        : directory,
    )) as typeof api.get);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function directoryCalls() {
  return get.mock.calls.filter(([path]) => path === "/api/directory");
}

describe("PeopleDirectory (#934)", () => {
  it("shows a single message when nobody is listed", async () => {
    await render();
    expect(container.textContent).toContain("noPeopleYet");
    expect(container.querySelector("tbody tr td img")).toBeNull();
  });

  it("renders one person with initials, headline, project, challenges and location", async () => {
    directory.items = [
      entry({
        displayName: "María José Fernández-Villaverde Rodríguez",
        headline: "Backend and data",
        locationNote: "Floor 1, table 12",
        project: { kind: "project", id: 3, name: "Rías Baixas Tracker" },
        challenges: [
          { id: 7, name: "Best hack" },
          { id: 8, name: "Open data" },
        ],
      }),
    ];
    await render();
    const text = container.textContent ?? "";
    expect(text).toContain("María José Fernández-Villaverde Rodríguez");
    expect(text).toContain("MR");
    expect(text).toContain("Backend and data");
    expect(text).toContain("Rías Baixas Tracker");
    expect(text).toContain("Best hack");
    expect(text).toContain("Open data");
    expect(text).toContain("Floor 1, table 12");
    expect(text).not.toContain("noPeopleYet");
  });

  it("renders many people and offers Next when the API has another page", async () => {
    directory = {
      items: Array.from({ length: 25 }, (_, i) => entry({ userId: i + 1, displayName: `P${i}` })),
      nextCursor: "abc",
    };
    await render();
    expect(container.querySelectorAll("tbody tr")).toHaveLength(25);
    const next = [...container.querySelectorAll("button")].find((b) => b.textContent === "next");
    expect(next).toBeDefined();
    await act(async () => next!.click());
    expect(navigation.replace).toHaveBeenCalledWith("/people?cursor=abc", { scroll: false });
  });

  it("sends the URL's search, challenge and cursor to the API", async () => {
    navigation.search = "q=jose&challenge=7&cursor=xyz";
    await render();
    expect(directoryCalls().at(-1)?.[1]).toEqual({
      query: { q: "jose", challengeId: "7", cursor: "xyz", limit: 25 },
    });
  });

  it("does not rewrite an already canonical URL across rerenders (R003)", async () => {
    navigation.search = "q=ana";
    await render();
    await render();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it("writes the debounced search to the URL and drops the cursor", async () => {
    navigation.search = "cursor=xyz";
    await render();
    const input = container.querySelector<HTMLInputElement>("#people-search")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "  Jose ");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(navigation.replace).not.toHaveBeenCalled();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    expect(navigation.replace).toHaveBeenCalledTimes(1);
    expect(navigation.replace).toHaveBeenCalledWith("/people?q=Jose", { scroll: false });
  });
});
