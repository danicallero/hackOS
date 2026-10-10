import userEvent from "@testing-library/user-event";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import type { CollectionItem, SponsorCollection } from "./company-collection";
import type { DiaryEntry } from "./event-diary";

const navigation = vi.hoisted(() => ({ search: "", replace: vi.fn(), push: vi.fn() }));
const env = vi.hoisted(() => ({
  canReadDirectory: true,
  isPureApplicant: false,
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("next/navigation", () => {
  const router = { replace: navigation.replace, push: navigation.push, prefetch: vi.fn() };
  return {
    useRouter: () => router,
    usePathname: () => "/people",
    useSearchParams: () => new URLSearchParams(navigation.search),
  };
});
vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  ApiError: class ApiError extends Error {},
}));
vi.mock("@/hooks/use-auto-refresh", () => ({ useAutoRefresh: () => 0 }));
vi.mock("@/lib/session", () => ({
  useCan: () => env.canReadDirectory,
  useSessionContext: () => ({ isPureApplicant: env.isPureApplicant }),
}));
vi.mock("@/lib/toast", () => ({
  toast: { error: env.toastError, success: env.toastSuccess },
}));
vi.mock("@/components/common/access-denied", () => ({
  AccessDenied: ({ ask }: { ask: string }) => <p>{ask}</p>,
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
const t = (key: string, values?: Record<string, unknown>) =>
  values ? `${key} ${JSON.stringify(values)}` : key;
vi.mock("@/lib/i18n", () => ({ useLocale: () => ({ t, language: "en" }) }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function person(overrides: Partial<DiaryEntry> = {}): DiaryEntry {
  return {
    id: 1,
    kind: "person",
    starred: false,
    note: null,
    createdAt: "2026-10-10T10:00:00.000Z",
    updatedAt: "2026-10-10T10:00:00.000Z",
    person: {
      userId: 41,
      displayName: "Ana P.",
      photoUrl: null,
      headline: "Builds robots",
      locationNote: "Table 4",
      project: { kind: "project", id: 3, name: "Rover" },
      challenges: [{ id: 7, name: "Best hack" }],
    },
    sponsor: null,
    ...overrides,
  };
}

function stand(overrides: Partial<DiaryEntry> = {}): DiaryEntry {
  return {
    id: 2,
    kind: "sponsor",
    starred: false,
    note: null,
    createdAt: "2026-10-10T09:00:00.000Z",
    updatedAt: "2026-10-10T09:00:00.000Z",
    person: null,
    sponsor: {
      enterpriseId: 5,
      name: "Acme",
      logoUrl: null,
      logoNegativeUrl: null,
      description: "We make things",
      website: "https://acme.test",
      challenges: [{ id: 8, name: "Open data" }],
    },
    ...overrides,
  };
}

function company(overrides: Partial<CollectionItem> = {}): CollectionItem {
  return {
    enterpriseId: 5,
    name: "Acme",
    logoUrl: null,
    logoNegativeUrl: null,
    description: "We make things",
    website: "https://acme.test",
    challenges: [{ id: 8, name: "Open data" }],
    entry: { id: 2, starred: false, note: null, createdAt: "2026-10-10T09:00:00.000Z" },
    ...overrides,
  };
}

let diary: DiaryEntry[];
let collection: SponsorCollection;
const get = vi.mocked(api.get);
const post = vi.mocked(api.post);
const patch = vi.mocked(api.patch);
const del = vi.mocked(api.delete);
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  navigation.search = "";
  navigation.replace.mockReset();
  navigation.push.mockReset();
  env.canReadDirectory = true;
  env.isPureApplicant = false;
  env.toastError.mockReset();
  env.toastSuccess.mockReset();
  diary = [];
  collection = { total: 0, collected: 0, items: [] };
  for (const mock of [get, post, patch, del]) mock.mockReset();
  get.mockImplementation(((path: string) => {
    if (path === "/api/me/diary") return Promise.resolve({ items: diary });
    if (path === "/api/me/diary/sponsors") return Promise.resolve(collection);
    if (path === "/api/directory")
      return Promise.resolve({
        items: [
          person().person,
          { ...person().person, userId: 42, displayName: "Bea R.", headline: null },
        ],
        nextCursor: null,
      });
    return Promise.resolve({ items: [] });
  }) as typeof api.get);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render() {
  const { EventDiary } = await import("./event-diary");
  await act(async () => {
    root.render(<EventDiary />);
  });
}

function table() {
  return container.querySelector("table") as HTMLTableElement;
}

function button(label: string) {
  return container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
}

function tab(name: string) {
  return [...container.querySelectorAll('[role="tab"]')].find(
    (el) => el.textContent === name,
  ) as HTMLElement;
}

function menuItem(name: string) {
  return [...document.querySelectorAll('[role="menuitem"]')].find(
    (item) => item.textContent === name,
  ) as HTMLElement;
}

describe("EventDiary (#935)", () => {
  it("shows a single message when nothing is saved", async () => {
    await render();
    expect(container.textContent).toContain("diaryEmpty");
    expect(get).toHaveBeenCalledWith("/api/me/diary");
    expect(get).not.toHaveBeenCalledWith("/api/directory", expect.anything());
  });

  it("lists only people in People, linking the whole row to their page", async () => {
    diary = [
      person({ starred: true, note: "Talk about ROS" }),
      stand(),
      person({ id: 3, person: null }),
    ];
    await render();
    const text = table().textContent ?? "";
    expect(text).toContain("Ana P.");
    expect(text).toContain("Builds robots");
    expect(text).toContain("Rover");
    expect(text).toContain("Talk about ROS");
    expect(text).toContain("diaryPersonUnavailable");
    expect(text).not.toContain("Acme");
    const rows = [...table().querySelectorAll("tbody tr")];
    expect(rows[0].className).toContain("cursor-pointer");
    expect(table().querySelector('a[href="/people/41"]')).not.toBeNull();
    // A person who no longer shares a profile has no destination.
    expect(rows[1].className).not.toContain("cursor-pointer");
    await act(async () => (rows[0].querySelector("td") as HTMLElement).click());
    expect(navigation.push).toHaveBeenCalledWith("/people/41");
  });

  it("toggles a favourite and keeps favourites first", async () => {
    diary = [
      person({
        id: 5,
        createdAt: "2026-10-10T11:00:00.000Z",
        person: { ...person().person!, userId: 43, displayName: "Cai D." },
      }),
      person({ id: 1, createdAt: "2026-10-10T08:00:00.000Z" }),
    ];
    patch.mockResolvedValue(person({ starred: true, createdAt: "2026-10-10T08:00:00.000Z" }));
    await render();
    const star = table().querySelector<HTMLButtonElement>(
      'button[aria-label="diaryFavourite: Ana P."]',
    )!;
    expect(star.getAttribute("aria-pressed")).toBe("false");
    await act(async () => star.click());
    expect(patch).toHaveBeenCalledWith("/api/me/diary/1", { starred: true });
    expect(navigation.push).not.toHaveBeenCalled();
    const rows = [...table().querySelectorAll("tbody tr")].map((row) => row.textContent);
    expect(rows[0]).toContain("Ana P.");
    expect(
      table()
        .querySelector('button[aria-label="diaryFavourite: Ana P."]')
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("never removes an entry when it is un-favourited, even under the Favourites filter", async () => {
    diary = [
      person({ starred: true }),
      person({ id: 6, person: { ...person().person!, userId: 44, displayName: "Dan E." } }),
    ];
    patch.mockResolvedValue(person({ starred: false }));
    await render();
    const user = userEvent.setup();
    await act(async () => user.click(button("diaryFavourites")!));
    expect(table().textContent).not.toContain("Dan E.");
    await act(async () => user.click(button("diaryFavourite: Ana P.")!));
    expect(patch).toHaveBeenCalledWith("/api/me/diary/1", { starred: false });
    expect(del).not.toHaveBeenCalled();
    await act(async () => user.click(button("diaryFavourites")!));
    const text = table().textContent ?? "";
    expect(text).toContain("Ana P.");
    expect(text).toContain("Dan E.");
  });

  it("searches saved people by name, project, challenge and note", async () => {
    diary = [
      person({ note: "Ask about the café" }),
      person({
        id: 6,
        person: {
          ...person().person!,
          userId: 44,
          displayName: "Dan E.",
          project: null,
          challenges: [],
        },
      }),
    ];
    await render();
    const user = userEvent.setup();
    const field = container.querySelector<HTMLInputElement>("#diary-search")!;
    await act(async () => user.type(field, "cafe"));
    expect(table().textContent).toContain("Ana P.");
    expect(table().textContent).not.toContain("Dan E.");
    await act(async () => user.clear(field));
    await act(async () => user.type(field, "rover"));
    expect(table().textContent).not.toContain("Dan E.");
  });

  it("saves a private note from the row menu without opening the row", async () => {
    diary = [person()];
    patch.mockResolvedValue(person({ note: "Met at lunch" }));
    await render();
    const user = userEvent.setup();
    await act(async () => user.click(button("openMenuAria: Ana P.")!));
    await act(async () => user.click(menuItem("diaryAddNote")));
    expect(navigation.push).not.toHaveBeenCalled();
    const textarea = document.querySelector<HTMLTextAreaElement>("#diary-note")!;
    expect(textarea.maxLength).toBe(500);
    await act(async () => user.type(textarea, "Met at lunch"));
    const saveButton = [...document.querySelectorAll("button")].find(
      (b) => b.textContent === "save",
    )!;
    await act(async () => user.click(saveButton));
    expect(patch).toHaveBeenCalledWith("/api/me/diary/1", { note: "Met at lunch" });
    expect(table().textContent).toContain("Met at lunch");
    expect(env.toastSuccess).toHaveBeenCalledWith("diaryNoteSaved", {
      compactTitle: "diaryNote",
    });
  });

  it("removes an entry only through Remove from diary, after confirmation", async () => {
    diary = [
      person(),
      person({ id: 6, person: { ...person().person!, userId: 44, displayName: "Dan E." } }),
    ];
    del.mockResolvedValue(undefined);
    await render();
    const user = userEvent.setup();
    await act(async () => user.click(button("openMenuAria: Dan E.")!));
    await act(async () => user.click(menuItem("diaryRemoveTitle")));
    const confirm = [...document.querySelectorAll('[role="alertdialog"] button')].find(
      (b) => b.textContent === "remove",
    ) as HTMLButtonElement;
    await act(async () => user.click(confirm));
    expect(del).toHaveBeenCalledWith("/api/me/diary/6");
    expect(table().textContent).not.toContain("Dan E.");
    expect(table().textContent).toContain("Ana P.");
  });

  it("saves from the directory, then offers Favourite instead of Save", async () => {
    diary = [person()];
    post.mockResolvedValue(
      person({ id: 9, person: { ...person().person!, userId: 42, displayName: "Bea R." } }),
    );
    await render();
    const user = userEvent.setup();
    await act(async () => user.click(tab("diaryDirectoryTab")));
    // The mocked URL never updates, so Radix's mousedown and focus activations
    // both see the old URL; both target the same canonical view.
    expect(new Set(navigation.replace.mock.calls.map(([url]) => url))).toEqual(
      new Set(["/people?tab=directory"]),
    );
    expect(get).toHaveBeenCalledWith("/api/directory", expect.anything());
    // Ana is already saved: the row says so and offers Favourite, not Save.
    expect(button("diarySave: Ana P.")).toBeNull();
    expect(button("diaryFavourite: Ana P.")).not.toBeNull();
    expect(table().textContent).toContain("diarySaved");
    await act(async () => user.click(button("diarySave: Bea R.")!));
    expect(post).toHaveBeenCalledWith("/api/me/diary/people", { userId: 42 });
    expect(navigation.push).not.toHaveBeenCalled();
    expect(button("diarySave: Bea R.")).toBeNull();
    expect(button("diaryFavourite: Bea R.")).not.toBeNull();
    // No visible remove action on directory rows; only the overflow menu has it.
    expect(table().textContent).not.toContain("diaryRemoveTitle");
  });

  it("does not rewrite the URL when the current view is selected again (R003)", async () => {
    navigation.search = "tab=directory";
    await render();
    const user = userEvent.setup();
    await act(async () => user.click(tab("diaryDirectoryTab")));
    await render();
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it("hides the directory without directory:read", async () => {
    env.canReadDirectory = false;
    diary = [person()];
    navigation.search = "tab=directory";
    await render();
    expect(tab("diaryDirectoryTab")).toBeUndefined();
    expect(tab("diaryPeopleTab")).toBeDefined();
    expect(table().textContent).toContain("Ana P.");
    expect(get).not.toHaveBeenCalledWith("/api/directory", expect.anything());
  });

  it("denies access without event access and opens no request", async () => {
    env.isPureApplicant = true;
    await render();
    expect(container.textContent).toContain("diaryAccessDeniedDesc");
    expect(get).not.toHaveBeenCalled();
  });
});

describe("Companies collection (#935)", () => {
  async function openCompanies() {
    navigation.search = "tab=companies";
    await render();
  }

  it("shows progress with collected and locked badges", async () => {
    collection = {
      total: 3,
      collected: 1,
      items: [
        company(),
        company({ enterpriseId: 6, name: "Beta", entry: null }),
        company({ enterpriseId: 7, name: "Zeta", entry: null }),
      ],
    };
    await openCompanies();
    expect(get).toHaveBeenCalledWith("/api/me/diary/sponsors");
    expect(container.textContent).toContain('diaryCollectionCount {"collected":1,"total":3}');
    expect(container.textContent).toContain("diaryCollectionHint");
    expect(button("Acme")).not.toBeNull();
    expect(button("Beta: diaryNotCollected")).not.toBeNull();
  });

  it("celebrates a complete collection and says so when there is nothing to collect", async () => {
    collection = { total: 1, collected: 1, items: [company()] };
    await openCompanies();
    expect(container.textContent).toContain("diaryCollectionComplete");
    act(() => root.unmount());
    root = createRoot(container);
    collection = { total: 0, collected: 0, items: [] };
    await openCompanies();
    expect(container.textContent).toContain("diaryCollectionEmpty");
  });

  it("opens a collected company and favourites it without removing it", async () => {
    collection = {
      total: 2,
      collected: 1,
      items: [company(), company({ enterpriseId: 6, name: "Beta", entry: null })],
    };
    patch.mockResolvedValue({ ...stand(), starred: true });
    await openCompanies();
    const user = userEvent.setup();
    await act(async () => user.click(button("Acme")!));
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.textContent).toContain("We make things");
    expect(dialog.textContent).toContain("Open data");
    const favourite = [...dialog.querySelectorAll("button")].find(
      (b) => b.textContent === "diaryFavourite",
    )!;
    await act(async () => user.click(favourite));
    expect(patch).toHaveBeenCalledWith("/api/me/diary/2", { starred: true });
    expect(favourite.getAttribute("aria-pressed")).toBe("true");
    patch.mockResolvedValue({ ...stand(), starred: false });
    await act(async () => user.click(favourite));
    expect(del).not.toHaveBeenCalled();
    expect(container.textContent).toContain('diaryCollectionCount {"collected":1,"total":2}');
  });

  it("filters the album to favourites", async () => {
    collection = {
      total: 2,
      collected: 2,
      items: [
        company({
          entry: { id: 2, starred: true, note: null, createdAt: "2026-10-10T09:00:00.000Z" },
        }),
        company({
          enterpriseId: 6,
          name: "Beta",
          entry: { id: 3, starred: false, note: null, createdAt: "2026-10-10T08:00:00.000Z" },
        }),
      ],
    };
    await openCompanies();
    const user = userEvent.setup();
    await act(async () => user.click(button("diaryFavourites")!));
    expect(button("Acme")).not.toBeNull();
    expect(button("Beta")).toBeNull();
  });
});
