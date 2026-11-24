import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "@/lib/api";
import type { DirectoryEntry } from "@/lib/directory";
import { API_URL } from "@/lib/env";
import { resetServerStateForTests } from "@/lib/server-state";

const env = vi.hoisted(() => ({ eventSource: vi.fn() }));

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      public code: string,
      message: string,
    ) {
      super(message);
    }
  },
  isNotFoundError: (err: unknown) => (err as { status?: number } | null)?.status === 404,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ back: vi.fn() }) }));
vi.mock("@/hooks/use-event-source", () => ({
  useEventSource: (...args: unknown[]) => {
    env.eventSource(...args);
    return { connected: true };
  },
}));
const t = (key: string) => key;
vi.mock("@/lib/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/i18n")>()),
  useLocale: () => ({ t, language: "es" }),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function entry(overrides: Partial<DirectoryEntry> = {}): DirectoryEntry {
  return {
    userId: 42,
    displayName: "Ana P.",
    photoUrl: null,
    headline: null,
    bio: null,
    locationNote: null,
    socials: [],
    cvUrl: null,
    projects: [],
    challenges: [],
    ...overrides,
  };
}

const get = vi.mocked(api.get);
let person: DirectoryEntry | Error;
let diaryItems: unknown[];
let container: HTMLDivElement;
let root: Root;

async function render(userId = 42, companyId?: number) {
  const { PersonDetail } = await import("./person-detail");
  await act(async () => {
    root.render(<PersonDetail userId={userId} companyId={companyId} />);
  });
}

beforeEach(() => {
  env.eventSource.mockReset();
  resetServerStateForTests();
  person = entry();
  diaryItems = [];
  get.mockReset();
  get.mockImplementation(((path: string) => {
    if (path === "/api/public/challenges") {
      return Promise.resolve({ items: [{ id: 7, title: { en: "Best hack", es: "Mejor hack" } }] });
    }
    if (path === "/api/me/diary") return Promise.resolve({ items: diaryItems });
    return person instanceof Error ? Promise.reject(person) : Promise.resolve(person);
  }) as typeof api.get);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("PersonDetail (#934, #935)", () => {
  it("shows everything the person made public", async () => {
    person = entry({
      headline: "Backend and data",
      bio: "Rust and maps.\nAsk me about PostGIS.",
      locationNote: "Floor 1, table 12",
      socials: [
        { kind: "linkedin", url: "https://www.linkedin.com/in/ana/" },
        { kind: "website", url: "https://ana.dev/" },
      ],
      cvUrl: "/api/directory/42/cv",
      projects: [{ kind: "project", id: 3, name: "Rías Baixas Tracker" }],
      challenges: [{ id: 7, name: "Best hack" }],
    });
    await render();

    expect(get).toHaveBeenCalledWith("/api/directory/42", expect.anything());
    expect(container.querySelector("h1")?.textContent).toBe("Ana P.");
    const text = container.textContent ?? "";
    expect(text).toContain("Backend and data");
    expect(text).toContain("Rust and maps.\nAsk me about PostGIS.");
    expect(text).toContain("Floor 1, table 12");
    expect(text).toContain("Rías Baixas Tracker");
    expect(text).toContain("Mejor hack");
    expect(text).toContain("linkedin.com/in/ana");
    expect(text).toContain("ana.dev");
    // The CV opens in the in-app viewer, not as a link to a new tab.
    expect(container.querySelector("a[href$='/cv']")).toBeNull();
    const fetchMock = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetchMock);
    const viewCv = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "viewCv",
    );
    await act(async () => viewCv?.click());
    expect(fetchMock).toHaveBeenCalledWith(
      `${API_URL}/api/directory/42/cv`,
      expect.objectContaining({ credentials: "include" }),
    );
    expect(document.querySelector("[role=dialog]")?.textContent).toContain("cvViewerTitle");
    vi.unstubAllGlobals();
    expect(container.querySelector("a[href='/people']")?.textContent).toBe("diary");
    expect(env.eventSource).toHaveBeenCalledWith(
      "domain:directory",
      expect.objectContaining({ events: ["domain.changed"] }),
    );
  });

  it("offers the diary favorite for a saved person and toggles it", async () => {
    diaryItems = [
      {
        id: 9,
        kind: "person",
        starred: false,
        note: null,
        createdAt: "2026-11-01T00:00:00Z",
        updatedAt: "2026-11-01T00:00:00Z",
        person: person as DirectoryEntry,
        sponsor: null,
      },
    ];
    vi.mocked(api.patch).mockResolvedValue({ ...(diaryItems[0] as object), starred: true });
    await render();
    const star = container.querySelector<HTMLButtonElement>("button[aria-pressed]");
    expect(star?.getAttribute("aria-pressed")).toBe("false");
    await act(async () => star?.click());
    expect(api.patch).toHaveBeenCalledWith("/api/me/diary/9", { starred: true });
    expect(container.querySelector("button[aria-pressed]")?.getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("returns to the originating company, including missing profiles", async () => {
    person = entry({ enterprises: [{ id: 7, name: "GPUL", logoUrl: null }] });
    await render(42, 7);
    expect(container.querySelector("a[href='/companies/7']")?.textContent).toBe("GPUL");
    expect(container.querySelector("a[href='/people']")).toBeNull();
    person = new ApiError(404, "not_found", "Person not found");
    await render(43, 7);
    expect(container.querySelector("a[href='/companies/7']")).not.toBeNull();
  });

  it("blurs the avatar's own photo request behind the hero (H48)", async () => {
    person = entry({ photoUrl: "/api/users/42/photo?v=ambient-test" });
    await render();
    const layer = container.querySelector("[data-hero-ambient] img[data-active]");
    expect(layer?.getAttribute("src")).toBe(`${API_URL}/api/users/42/photo?v=ambient-test`);
    // Same no-CORS request as the avatar, so the private photo is not fetched twice.
    expect(layer?.hasAttribute("crossorigin")).toBe(false);
  });

  it("keeps the single-color wash without a photo", async () => {
    await render();
    expect(container.querySelector("[data-hero-bleed]")).not.toBeNull();
    expect(container.querySelector("[data-hero-ambient]")).toBeNull();
  });

  it("lists every project and work group the person is in", async () => {
    person = entry({
      projects: [
        { kind: "project", id: 3, name: "Rías Baixas Tracker" },
        { kind: "project", id: 4, name: "Rover" },
        { kind: "workGroup", id: 5, name: "Side quest" },
      ],
    });
    await render();
    const text = container.textContent ?? "";
    for (const name of [
      "Rías Baixas Tracker",
      "Rover",
      "Side quest",
      "publicProfileProjects",
      "publicProfileWorkGroup",
    ]) {
      expect(text).toContain(name);
    }
  });

  it("omits empty sections and the CV action", async () => {
    await render();
    expect(container.querySelector("dl")).toBeNull();
    expect(container.textContent).not.toContain("viewCv");
  });

  it("treats a hidden or missing person as not found", async () => {
    person = new ApiError(404, "not_found", "Person not found");
    await render();
    expect(container.querySelector("h1")?.textContent).toBe("personNotFound");
    expect(container.querySelector("a[href='/people']")).not.toBeNull();
  });

  it("keeps a failed load in place with a retry", async () => {
    person = new ApiError(500, "internal", "Server down");
    await render();
    expect(container.querySelector("[role=alert]")?.textContent).toContain("apiErrorServer");
    person = entry({ displayName: "Back again" });
    const retry = [...container.querySelectorAll("button")].find((b) => b.textContent === "retry");
    await act(async () => retry?.click());
    expect(container.querySelector("h1")?.textContent).toBe("Back again");
  });
});

describe("shared helper identity (H63)", () => {
  it("puts company with logo before knowledge and keeps presence on the avatar", async () => {
    const { PersonProfile } = await import("./person-detail");
    const renderProfile = (present: boolean) =>
      root.render(
        <PersonProfile
          entry={entry({
            helpTopics: [{ id: 1, name: "Angular" }],
            enterprises: [{ id: 7, name: "QA Corp", logoUrl: "/api/enterprises/7/logo" }],
          })}
          context="Support team"
          visibleRole="Mentor"
          present={present}
        />,
      );
    await act(async () => renderProfile(true));
    expect(container.querySelector("header")?.textContent).not.toContain("Mentor");
    const contextRow = container.querySelector("[data-hero-bleed] > div:last-child > div");
    expect(contextRow?.textContent).toBe("Support teamMentor");
    expect(contextRow?.className).toContain("justify-between");
    expect(container.querySelector('img[src$="/api/enterprises/7/logo"]')).not.toBeNull();
    // The company opens its page, as everywhere else the profile is shown.
    expect(container.querySelector('a[href="/companies/7"]')?.textContent).toContain("QA Corp");
    expect([...container.querySelectorAll("section > h2")].map((el) => el.textContent)).toEqual([
      "helpDeskCompany",
      "helpDeskKnowledge",
    ]);
    expect(container.textContent).toContain("helpDeskPresent");
    await act(async () => renderProfile(false));
    expect(container.textContent).not.toContain("helpDeskPresent");
    expect(container.textContent).not.toContain("helpDeskOutside");
  });
});
