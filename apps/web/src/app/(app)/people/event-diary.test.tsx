import userEvent from "@testing-library/user-event";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import type { DiaryEntry } from "./event-diary";

const navigation = vi.hoisted(() => ({ search: "", replace: vi.fn() }));
const env = vi.hoisted(() => ({
  canReadDirectory: true,
  isPureApplicant: false,
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
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
const t = (key: string) => key;
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

let diary: DiaryEntry[];
const get = vi.mocked(api.get);
const post = vi.mocked(api.post);
const patch = vi.mocked(api.patch);
const del = vi.mocked(api.delete);
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  navigation.search = "";
  navigation.replace.mockReset();
  env.canReadDirectory = true;
  env.isPureApplicant = false;
  env.toastError.mockReset();
  env.toastSuccess.mockReset();
  diary = [];
  for (const mock of [get, post, patch, del]) mock.mockReset();
  get.mockImplementation(((path: string) => {
    if (path === "/api/me/diary") return Promise.resolve({ items: diary });
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

describe("EventDiary (#935)", () => {
  it("shows a single message when nothing is saved", async () => {
    await render();
    expect(container.textContent).toContain("diaryEmpty");
    expect(get).toHaveBeenCalledWith("/api/me/diary");
    expect(get).not.toHaveBeenCalledWith("/api/directory", expect.anything());
  });

  it("lists people, stands and unavailable entries, linking people to their page", async () => {
    diary = [
      person({ starred: true, note: "Talk about ROS" }),
      stand(),
      person({ id: 3, person: null }),
      stand({ id: 4, sponsor: null }),
    ];
    await render();
    const text = table().textContent ?? "";
    expect(text).toContain("Ana P.");
    expect(text).toContain("Builds robots");
    expect(text).toContain("Rover");
    expect(text).toContain("Talk about ROS");
    expect(text).toContain("Acme");
    expect(text).toContain("We make things");
    expect(text).toContain("Open data");
    expect(text).toContain("diaryPersonUnavailable");
    expect(text).toContain("diaryUnavailable");
    expect(table().querySelector('a[href="/people/41"]')).not.toBeNull();
    expect(table().querySelector('a[href="https://acme.test"]')).not.toBeNull();
  });

  it("toggles a favourite and keeps favourites first", async () => {
    diary = [stand(), person({ id: 1, createdAt: "2026-10-10T08:00:00.000Z" })];
    patch.mockResolvedValue(person({ starred: true, createdAt: "2026-10-10T08:00:00.000Z" }));
    await render();
    const star = table().querySelector<HTMLButtonElement>(
      'button[aria-label="diaryFavourite: Ana P."]',
    )!;
    expect(star.getAttribute("aria-pressed")).toBe("false");
    await act(async () => star.click());
    expect(patch).toHaveBeenCalledWith("/api/me/diary/1", { starred: true });
    const rows = [...table().querySelectorAll("tbody tr")].map((row) => row.textContent);
    expect(rows[0]).toContain("Ana P.");
    expect(
      table()
        .querySelector('button[aria-label="diaryFavourite: Ana P."]')
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("saves a private note from the row menu", async () => {
    diary = [person()];
    patch.mockResolvedValue(person({ note: "Met at lunch" }));
    await render();
    const user = userEvent.setup();
    await act(async () =>
      user.click(table().querySelector('button[aria-label="openMenuAria: Ana P."]')!),
    );
    const addNote = [...document.querySelectorAll('[role="menuitem"]')].find(
      (item) => item.textContent === "diaryAddNote",
    ) as HTMLElement;
    await act(async () => user.click(addNote));
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

  it("removes an entry after confirmation", async () => {
    diary = [person(), stand()];
    del.mockResolvedValue(undefined);
    await render();
    const user = userEvent.setup();
    await act(async () =>
      user.click(table().querySelector('button[aria-label="openMenuAria: Acme"]')!),
    );
    const remove = [...document.querySelectorAll('[role="menuitem"]')].find(
      (item) => item.textContent === "remove",
    ) as HTMLElement;
    await act(async () => user.click(remove));
    const confirm = [...document.querySelectorAll('[role="alertdialog"] button')].find(
      (b) => b.textContent === "remove",
    ) as HTMLButtonElement;
    await act(async () => user.click(confirm));
    expect(del).toHaveBeenCalledWith("/api/me/diary/2");
    expect(table().textContent).not.toContain("Acme");
    expect(table().textContent).toContain("Ana P.");
  });

  it("switches to the directory and saves a person, reflecting saved state", async () => {
    diary = [person()];
    post.mockResolvedValue(
      person({ id: 9, person: { ...person().person!, userId: 42, displayName: "Bea R." } }),
    );
    await render();
    const user = userEvent.setup();
    const tab = [...container.querySelectorAll('[role="tab"]')].find(
      (el) => el.textContent === "diaryDirectoryTab",
    ) as HTMLElement;
    await act(async () => user.click(tab));
    // The mocked URL never updates, so Radix's mousedown and focus activations
    // both see the old URL; both target the same canonical view.
    expect(new Set(navigation.replace.mock.calls.map(([url]) => url))).toEqual(
      new Set(["/people?tab=directory"]),
    );
    expect(get).toHaveBeenCalledWith("/api/directory", expect.anything());
    const savedAna = table().querySelector<HTMLButtonElement>(
      'button[aria-label="diarySaved: Ana P."]',
    );
    expect(savedAna?.disabled).toBe(true);
    const saveBea = table().querySelector<HTMLButtonElement>(
      'button[aria-label="diarySave: Bea R."]',
    )!;
    await act(async () => user.click(saveBea));
    expect(post).toHaveBeenCalledWith("/api/me/diary/people", { userId: 42 });
    expect(table().querySelector('button[aria-label="diarySaved: Bea R."]')).not.toBeNull();
  });

  it("does not rewrite the URL when the current view is selected again (R003)", async () => {
    navigation.search = "tab=directory";
    await render();
    const user = userEvent.setup();
    const tab = [...container.querySelectorAll('[role="tab"]')].find(
      (el) => el.textContent === "diaryDirectoryTab",
    ) as HTMLElement;
    await act(async () => user.click(tab));
    await render();
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it("shows only the diary without directory:read", async () => {
    env.canReadDirectory = false;
    diary = [stand()];
    navigation.search = "tab=directory";
    await render();
    expect(container.querySelector('[role="tab"]')).toBeNull();
    expect(table().textContent).toContain("Acme");
    expect(get).not.toHaveBeenCalledWith("/api/directory", expect.anything());
  });

  it("denies access without event access and opens no request", async () => {
    env.isPureApplicant = true;
    await render();
    expect(container.textContent).toContain("diaryAccessDeniedDesc");
    expect(get).not.toHaveBeenCalled();
  });
});
