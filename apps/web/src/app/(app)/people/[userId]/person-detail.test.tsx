import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "@/lib/api";
import type { DirectoryEntry } from "@/lib/directory";
import { API_URL } from "@/lib/env";

const env = vi.hoisted(() => ({ canRead: true, refreshNonce: 0, autoRefresh: vi.fn() }));

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn() },
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      public code: string,
      message: string,
    ) {
      super(message);
    }
  },
}));
vi.mock("@/hooks/use-auto-refresh", () => ({
  useAutoRefresh: (...args: unknown[]) => {
    env.autoRefresh(...args);
    return env.refreshNonce;
  },
}));
vi.mock("@/lib/session", () => ({ useCan: () => env.canRead }));
vi.mock("@/components/common/access-denied", () => ({
  AccessDenied: ({ ask }: { ask: string }) => <p>{ask}</p>,
}));
const t = (key: string) => key;
vi.mock("@/lib/i18n", () => ({ useLocale: () => ({ t, language: "es" }) }));

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
    project: null,
    challenges: [],
    ...overrides,
  };
}

const get = vi.mocked(api.get);
let person: DirectoryEntry | Error;
let container: HTMLDivElement;
let root: Root;

async function render(userId = 42) {
  const { PersonDetail } = await import("./person-detail");
  await act(async () => {
    root.render(<PersonDetail userId={userId} />);
  });
}

beforeEach(() => {
  env.canRead = true;
  env.refreshNonce = 0;
  env.autoRefresh.mockReset();
  person = entry();
  get.mockReset();
  get.mockImplementation(((path: string) => {
    if (path === "/api/public/challenges") {
      return Promise.resolve({ items: [{ id: 7, title: { en: "Best hack", es: "Mejor hack" } }] });
    }
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
      project: { kind: "project", id: 3, name: "Rías Baixas Tracker" },
      challenges: [{ id: 7, name: "Best hack" }],
    });
    await render();

    expect(get).toHaveBeenCalledWith("/api/directory/42");
    expect(container.querySelector("h1")?.textContent).toBe("Ana P.");
    const text = container.textContent ?? "";
    expect(text).toContain("Backend and data");
    expect(text).toContain("Rust and maps.\nAsk me about PostGIS.");
    expect(text).toContain("Floor 1, table 12");
    expect(text).toContain("Rías Baixas Tracker");
    expect(text).toContain("Mejor hack");
    expect(text).toContain("linkedin.com/in/ana");
    expect(text).toContain("ana.dev");
    const cv = container.querySelector<HTMLAnchorElement>(
      `a[href='${API_URL}/api/directory/42/cv']`,
    );
    expect(cv?.textContent).toBe("downloadCv");
    expect(container.querySelector("a[href='/people']")?.textContent).toBe("backToPeople");
    expect(env.autoRefresh).toHaveBeenCalledWith("/api/events/stream?topic=directory", [
      "domain.changed",
    ]);
  });

  it("omits empty sections and the CV action", async () => {
    await render();
    expect(container.querySelector("dl")).toBeNull();
    expect(container.textContent).not.toContain("downloadCv");
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
    expect(container.querySelector("[role=alert]")?.textContent).toContain("Server down");
    person = entry({ displayName: "Back again" });
    const retry = [...container.querySelectorAll("button")].find((b) => b.textContent === "retry");
    await act(async () => retry?.click());
    expect(container.querySelector("h1")?.textContent).toBe("Back again");
  });

  it("opens nothing without directory access", async () => {
    env.canRead = false;
    await render();
    expect(container.textContent).toBe("peopleAccessDeniedDesc");
    expect(get).not.toHaveBeenCalled();
  });
});
