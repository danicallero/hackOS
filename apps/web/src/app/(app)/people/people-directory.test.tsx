import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import type { DirectoryEntry } from "./people-directory";

const navigation = vi.hoisted(() => ({
  search: "",
  replace: vi.fn(),
}));
const env = vi.hoisted(() => ({
  canRead: true,
  language: "en",
  refreshNonce: 0,
  autoRefresh: vi.fn(),
  toastError: vi.fn(),
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

vi.mock("@/hooks/use-auto-refresh", () => ({
  useAutoRefresh: (...args: unknown[]) => {
    env.autoRefresh(...args);
    return env.refreshNonce;
  },
}));
vi.mock("@/lib/session", () => ({ useCan: () => env.canRead }));
vi.mock("@/lib/toast", () => ({ toast: { error: env.toastError } }));
vi.mock("@/components/common/access-denied", () => ({
  AccessDenied: ({ ask }: { ask: string }) => <p>{ask}</p>,
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));

const t = (key: string, values?: Record<string, string | number>) =>
  values ? Object.entries(values).reduce((s, [k, v]) => s.replace(`{${k}}`, String(v)), key) : key;
vi.mock("@/lib/i18n", () => ({ useLocale: () => ({ t, language: env.language }) }));

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
  env.canRead = true;
  env.language = "en";
  env.refreshNonce = 0;
  env.autoRefresh.mockReset();
  env.toastError.mockReset();
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

async function wait(ms = 300) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

async function type(value: string) {
  const input = container.querySelector<HTMLInputElement>("#people-search")!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function button(label: string) {
  return [...container.querySelectorAll("button")].find((b) => b.textContent === label);
}

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

  it("keeps typing made after the debounce when its own URL write echoes back (R003)", async () => {
    await render();
    await type("an");
    await wait();
    expect(navigation.replace).toHaveBeenLastCalledWith("/people?q=an", { scroll: false });
    await type("ana");
    navigation.search = "q=an";
    await render();
    expect(container.querySelector<HTMLInputElement>("#people-search")!.value).toBe("ana");
  });

  it("resets the field on back/forward navigation (R003)", async () => {
    navigation.search = "q=ana";
    await render();
    navigation.search = "q=bob";
    await render();
    expect(container.querySelector<HTMLInputElement>("#people-search")!.value).toBe("bob");
    await wait();
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it("treats a linked search with spaces as canonical", async () => {
    navigation.search = "q=%20ana%20";
    await render();
    await wait();
    expect(navigation.replace).not.toHaveBeenCalled();
    expect(directoryCalls().at(-1)?.[1]).toEqual({ query: { q: "ana", limit: 25 } });
  });

  it("denies access without directory:read and opens no request or stream", async () => {
    env.canRead = false;
    await render();
    expect(container.textContent).toContain("peopleAccessDeniedDesc");
    expect(get).not.toHaveBeenCalled();
    expect(env.autoRefresh).not.toHaveBeenCalled();
  });

  it.each([
    ["es", "Mejor hack"],
    ["gl", "Mellor hack"],
  ])("shows challenge chips in the reader's language (%s)", async (language, title) => {
    env.language = language;
    directory.items = [entry({ challenges: [{ id: 7, name: "Best hack" }] })];
    await render();
    expect(container.querySelector("tbody")?.textContent).toContain(title);
    expect(container.querySelector("tbody")?.textContent).not.toContain("Best hack");
  });

  it("disables paging while a new query loads and drops the old query's cursor", async () => {
    directory = { items: [entry()], nextCursor: "abc" };
    await render();
    expect(button("next")?.disabled).toBe(false);
    get.mockImplementation(((path: string) =>
      path === "/api/directory"
        ? new Promise(() => {})
        : Promise.resolve({ items: [] })) as typeof api.get);
    navigation.search = "q=bob&cursor=zzz";
    await render();
    expect(button("previous")?.disabled).toBe(true);
    const next = button("next");
    if (next) expect(next.disabled).toBe(true);
    await act(async () => next?.click());
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it("keeps the rows and warns when a background refresh fails", async () => {
    directory.items = [entry({ displayName: "Ana P." })];
    await render();
    get.mockImplementation(((path: string) =>
      path === "/api/directory"
        ? Promise.reject(new Error("offline"))
        : Promise.resolve({ items: [] })) as typeof api.get);
    env.refreshNonce = 1;
    await render();
    expect(container.querySelector("tbody")?.textContent).toContain("Ana P.");
    expect(env.toastError).toHaveBeenCalledWith("couldNotLoadPeople", "columnPeople");
  });
});
