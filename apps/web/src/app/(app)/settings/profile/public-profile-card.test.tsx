import userEvent from "@testing-library/user-event";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const me = { id: 7, name: "María José", surname: "Fernández-Villaverde", image: null };

vi.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      public code: string,
      message: string,
    ) {
      super(message);
    }
  },
  api: { get: vi.fn(), put: vi.fn() },
}));
vi.mock("@/lib/i18n", () => {
  const t = (key: string) => key;
  return { useLocale: () => ({ t }) };
});
vi.mock("@/lib/session", () => ({ useSessionContext: () => ({ me }) }));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/use-unsaved-changes-guard", () => ({ useUnsavedChangesGuard: vi.fn() }));
vi.mock("@/hooks/use-auto-refresh", () => ({ useAutoRefresh: () => 0 }));

import { ApiError, api } from "@/lib/api";
import { DirectoryCard, type DirectoryEntry, PublicProfileCard } from "./public-profile-card";

function profile(overrides: Record<string, unknown> = {}, preview: Partial<DirectoryEntry> = {}) {
  return {
    directoryVisible: false,
    showSurname: false,
    showPhoto: false,
    showProject: true,
    headline: null,
    locationNote: null,
    consentedAt: null,
    preview: {
      userId: 7,
      displayName: "María José F.",
      photoUrl: null,
      headline: null,
      locationNote: null,
      project: null,
      challenges: [],
      ...preview,
    },
    ...overrides,
  };
}

describe("PublicProfileCard", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    vi.mocked(api.get).mockReset();
    vi.mocked(api.put).mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function render(node: React.ReactNode) {
    await act(async () => root.render(node));
  }

  const byLabel = (label: string) => {
    const id = [...container.querySelectorAll("label")].find(
      (l) => l.textContent === label,
    )?.htmlFor;
    return id ? document.getElementById(id) : null;
  };

  it("hides the dependent fields and preview while the opt-in is off", async () => {
    vi.mocked(api.get).mockResolvedValue(profile());
    await render(<PublicProfileCard />);

    expect(container.textContent).toContain("publicProfileVisible");
    expect(container.textContent).toContain("publicProfileAudience");
    expect(container.textContent).not.toContain("publicProfileShowSurname");
    expect(container.textContent).not.toContain("publicProfileHeadline");
    expect(container.textContent).not.toContain("publicProfilePreview");
  });

  it("reveals the fields and a live preview once opted in", async () => {
    vi.mocked(api.get).mockResolvedValue(profile());
    await render(<PublicProfileCard />);
    const user = userEvent.setup();

    await act(async () => user.click(byLabel("publicProfileVisible") as HTMLButtonElement));
    expect(container.textContent).toContain("publicProfileShowPhoto");
    expect(container.textContent).toContain("María José F.");

    await act(async () => user.click(byLabel("publicProfileShowSurname") as HTMLButtonElement));
    expect(container.textContent).toContain("María José Fernández-Villaverde");
  });

  it("saves the full settings with an idempotency key and adopts the response", async () => {
    vi.mocked(api.get).mockResolvedValue(profile());
    vi.mocked(api.put).mockResolvedValue(
      profile({ directoryVisible: true, headline: "Rust" }, { headline: "Rust" }),
    );
    await render(<PublicProfileCard />);
    const user = userEvent.setup();

    await act(async () => user.click(byLabel("publicProfileVisible") as HTMLButtonElement));
    const headline = byLabel("publicProfileHeadline") as HTMLInputElement;
    await act(async () => user.type(headline, "  Rust  "));
    const submit = container.querySelector<HTMLButtonElement>("button[type=submit]");
    expect(submit?.disabled).toBe(false);
    await act(async () => (container.querySelector("form") as HTMLFormElement).requestSubmit());

    expect(api.put).toHaveBeenCalledWith(
      "/api/me/public-profile",
      {
        directoryVisible: true,
        showSurname: false,
        showPhoto: false,
        showProject: true,
        headline: "Rust",
        locationNote: null,
      },
      { headers: { "Idempotency-Key": expect.any(String) } },
    );
    expect(container.textContent).toContain("saved");
  });

  it("stays hidden without event access", async () => {
    vi.mocked(api.get).mockRejectedValue(new ApiError(403, "forbidden", "Forbidden"));
    await render(<PublicProfileCard />);
    expect(container.textContent).toBe("");
  });
});

describe("DirectoryCard", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const entry: DirectoryEntry = {
    userId: 7,
    displayName: "María José F.",
    photoUrl: null,
    headline: null,
    locationNote: null,
    project: null,
    challenges: [],
  };

  it("shows only the name when nothing else is public", () => {
    act(() => root.render(<DirectoryCard entry={entry} />));
    expect(container.querySelector("ul")).toBeNull();
    expect(container.textContent).toBe("MJMaría José F.");
  });

  it("lists one or many challenges under the project", () => {
    act(() =>
      root.render(
        <DirectoryCard
          entry={{
            ...entry,
            project: { kind: "project", id: 1, name: "Very long project name" },
            challenges: [{ id: 1, name: "Best use of open data" }],
          }}
        />,
      ),
    );
    expect(container.querySelectorAll("li")).toHaveLength(1);
    expect(container.textContent).toContain("Very long project name");

    const many = Array.from({ length: 6 }, (_, i) => ({ id: i + 1, name: `Challenge ${i + 1}` }));
    act(() =>
      root.render(
        <DirectoryCard
          entry={{
            ...entry,
            project: { kind: "workGroup", id: 2, name: "Group" },
            challenges: many,
          }}
        />,
      ),
    );
    expect(container.querySelectorAll("li")).toHaveLength(6);
  });
});
