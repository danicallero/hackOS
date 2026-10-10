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
  api: { get: vi.fn(), put: vi.fn(), delete: vi.fn() },
  apiUpload: vi.fn(),
}));
vi.mock("@/lib/i18n", () => {
  const t = (key: string) => key;
  return { useLocale: () => ({ t }) };
});
vi.mock("@/lib/session", () => ({ useSessionContext: () => ({ me }) }));
vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  showErrorToast: vi.fn(),
}));
vi.mock("@/lib/use-unsaved-changes-guard", () => ({ useUnsavedChangesGuard: vi.fn() }));
// Minimal useLiveQuery: one read on mount; `live.refetch` stands in for a stream event.
const live = vi.hoisted(() => ({
  refetch: (_trigger?: string) => {},
  args: [] as unknown[],
}));
vi.mock("@/hooks/use-event-source", async () => {
  const React = await import("react");
  return {
    useLiveQuery: (fetcher: () => Promise<unknown>, ...args: unknown[]) => {
      live.args = args;
      const [state, setState] = React.useState<{ data: unknown; error: unknown }>({
        data: null,
        error: null,
      });
      const fetcherRef = React.useRef(fetcher);
      fetcherRef.current = fetcher;
      const refetch = React.useCallback(() => {
        fetcherRef.current().then(
          (data) => setState({ data, error: null }),
          (error) => setState((s) => ({ ...s, error })),
        );
      }, []);
      live.refetch = refetch;
      React.useEffect(() => refetch(), [refetch]);
      return { ...state, loading: false, connected: true, refetch };
    },
  };
});

import { EVENTS } from "@hackos/shared/events";
import { ApiError, api, apiUpload } from "@/lib/api";
import { API_URL } from "@/lib/env";
import { showErrorToast, toast } from "@/lib/toast";
import {
  DirectoryCard,
  type DirectoryEntry,
  displayName,
  PublicProfileCard,
} from "./public-profile-card";

function profile(overrides: Record<string, unknown> = {}, preview: Partial<DirectoryEntry> = {}) {
  return {
    directoryVisible: false,
    showSurname: false,
    showPhoto: false,
    showProject: true,
    headline: null,
    bio: null,
    locationNote: null,
    socials: [],
    shareCv: false,
    cv: null,
    consentedAt: null,
    preview: {
      userId: 7,
      displayName: "María José F.",
      photoUrl: null,
      headline: null,
      bio: null,
      locationNote: null,
      socials: [],
      cvUrl: null,
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
    vi.mocked(toast.error).mockReset();
    vi.mocked(showErrorToast).mockReset();
  });

  const submit = () => container.querySelector<HTMLButtonElement>("button[type=submit]");
  const save = () =>
    act(async () => (container.querySelector("form") as HTMLFormElement).requestSubmit());
  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  }

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
        bio: null,
        socials: [],
        shareCv: false,
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

  it("refreshes on the personal stream, not the global directory topic", async () => {
    vi.mocked(api.get).mockResolvedValue(profile());
    await render(<PublicProfileCard />);
    expect(live.args.slice(0, 2)).toEqual(["/api/queue/me/stream", [EVENTS.USER_SESSION_CHANGED]]);
  });

  it("locks the fields while saving so no edit is lost", async () => {
    vi.mocked(api.get).mockResolvedValue(profile({ directoryVisible: true }));
    const put = deferred<ReturnType<typeof profile>>();
    vi.mocked(api.put).mockReturnValue(put.promise as never);
    await render(<PublicProfileCard />);
    const user = userEvent.setup();

    await act(async () => user.type(byLabel("publicProfileHeadline") as HTMLInputElement, "Go"));
    await save();
    const headline = byLabel("publicProfileHeadline") as HTMLInputElement;
    expect(headline.matches(":disabled")).toBe(true);
    expect(byLabel("publicProfileShowPhoto")?.matches(":disabled")).toBe(true);

    await act(async () =>
      put.resolve(profile({ directoryVisible: true, headline: "Go" }, { headline: "Go" })),
    );
    expect(headline.matches(":disabled")).toBe(false);
    expect(headline.value).toBe("Go");
    expect(submit()?.disabled).toBe(true);
  });

  it("ignores a read that started before a save and lands after it", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(profile({ directoryVisible: true }));
    await render(<PublicProfileCard />);
    const stale = deferred<ReturnType<typeof profile>>();
    vi.mocked(api.get).mockReturnValueOnce(stale.promise as never);
    await act(async () => live.refetch());

    vi.mocked(api.put).mockResolvedValue(
      profile({ directoryVisible: true, headline: "New" }, { headline: "New" }),
    );
    const user = userEvent.setup();
    await act(async () => user.type(byLabel("publicProfileHeadline") as HTMLInputElement, "New"));
    await save();
    await act(async () => stale.resolve(profile({ directoryVisible: true, headline: "Old" })));

    expect((byLabel("publicProfileHeadline") as HTMLInputElement).value).toBe("New");

    vi.mocked(api.get).mockResolvedValueOnce(
      profile({ directoryVisible: true, headline: "Later" }),
    );
    await act(async () => live.refetch());
    expect((byLabel("publicProfileHeadline") as HTMLInputElement).value).toBe("Later");
  });

  it("shows a load failure in place with a retry instead of a toast", async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new ApiError(500, "internal", "Server down"));
    await render(<PublicProfileCard />);

    expect(container.querySelector("[role=alert]")?.textContent).toContain("Server down");
    expect(toast.error).not.toHaveBeenCalled();
    expect(showErrorToast).not.toHaveBeenCalled();

    vi.mocked(api.get).mockResolvedValueOnce(profile());
    const retry = [...container.querySelectorAll("button")].find((b) => b.textContent === "retry");
    await act(async () => retry?.click());
    expect(container.querySelector("[role=alert]")).toBeNull();
    expect(container.textContent).toContain("publicProfileVisible");
  });

  it("does not count or publish hidden fields while the opt-in is off", async () => {
    vi.mocked(api.get).mockResolvedValue(profile());
    await render(<PublicProfileCard />);
    const user = userEvent.setup();

    await act(async () => user.click(byLabel("publicProfileVisible") as HTMLButtonElement));
    await act(async () => user.type(byLabel("publicProfileHeadline") as HTMLInputElement, "Hi"));
    await act(async () => user.click(byLabel("publicProfileVisible") as HTMLButtonElement));
    expect(submit()?.disabled).toBe(true);
  });

  it("turning the opt-in off keeps the stored public text", async () => {
    vi.mocked(api.get).mockResolvedValue(profile({ directoryVisible: true, headline: "Rust" }));
    vi.mocked(api.put).mockResolvedValue(profile({ headline: "Rust" }));
    await render(<PublicProfileCard />);
    const user = userEvent.setup();

    const headline = byLabel("publicProfileHeadline") as HTMLInputElement;
    await act(async () => user.clear(headline));
    await act(async () => user.type(headline, "Secret"));
    await act(async () => user.click(byLabel("publicProfileVisible") as HTMLButtonElement));
    expect(submit()?.disabled).toBe(false);
    await save();

    expect(api.put).toHaveBeenCalledWith(
      "/api/me/public-profile",
      expect.objectContaining({ directoryVisible: false, headline: "Rust" }),
      expect.anything(),
    );
  });

  it("saves the bio and links, skipping empty link rows", async () => {
    vi.mocked(api.get).mockResolvedValue(profile({ directoryVisible: true }));
    vi.mocked(api.put).mockResolvedValue(profile({ directoryVisible: true }));
    await render(<PublicProfileCard />);
    const user = userEvent.setup();

    await act(async () => user.type(byLabel("publicProfileBio") as HTMLTextAreaElement, "Hi"));
    const addLink = () =>
      [...container.querySelectorAll("button")].find(
        (b) => b.textContent === "publicProfileAddLink",
      ) as HTMLButtonElement;
    await act(async () => user.click(addLink()));
    await act(async () => user.click(addLink()));
    const urls = container.querySelectorAll<HTMLInputElement>(
      "input[aria-label=publicProfileLinkUrl]",
    );
    expect(urls).toHaveLength(2);
    await act(async () => user.type(urls[0] as HTMLInputElement, " github.com/maria "));
    expect(container.textContent).toContain("github.com/maria");
    await save();

    expect(api.put).toHaveBeenCalledWith(
      "/api/me/public-profile",
      expect.objectContaining({
        bio: "Hi",
        socials: [{ kind: "linkedin", url: "github.com/maria" }],
      }),
      expect.anything(),
    );
  });

  it("removes a link row and stops offering more after six", async () => {
    const socials = Array.from({ length: 6 }, (_, i) => ({
      kind: "other",
      url: `https://example.com/${i}`,
    }));
    vi.mocked(api.get).mockResolvedValue(profile({ directoryVisible: true, socials }));
    await render(<PublicProfileCard />);
    const buttons = () => [...container.querySelectorAll("button")];
    expect(buttons().some((b) => b.textContent === "publicProfileAddLink")).toBe(false);

    const user = userEvent.setup();
    const removeLink = container.querySelector<HTMLButtonElement>(
      "button[aria-label=publicProfileRemoveLink]",
    );
    await act(async () => user.click(removeLink as HTMLButtonElement));
    expect(container.querySelectorAll("input[aria-label=publicProfileLinkUrl]")).toHaveLength(5);
    expect(buttons().some((b) => b.textContent === "publicProfileAddLink")).toBe(true);
    expect(submit()?.disabled).toBe(false);
  });

  it("uploads a CV on its own and only then offers to share it", async () => {
    vi.mocked(api.get).mockResolvedValue(profile({ directoryVisible: true }));
    const withCv = profile({
      directoryVisible: true,
      cv: { filename: "maria.pdf", uploadedAt: "2026-10-10T10:00:00.000Z" },
    });
    vi.mocked(apiUpload).mockResolvedValue(withCv);
    await render(<PublicProfileCard />);
    expect(byLabel("publicProfileShareCv")).toBeNull();

    const input = container.querySelector<HTMLInputElement>("input[type=file]");
    const file = new File(["%PDF-1.7"], "maria.pdf", { type: "application/pdf" });
    const user = userEvent.setup();
    await act(async () => user.upload(input as HTMLInputElement, file));

    expect(apiUpload).toHaveBeenCalledWith("/api/me/public-profile/cv", expect.any(FormData));
    expect(container.textContent).toContain("maria.pdf");
    expect(byLabel("publicProfileShareCv")).not.toBeNull();
    // The file saved itself; the form has nothing new to save.
    expect(submit()?.disabled).toBe(true);
  });

  it("refuses a non-PDF CV before uploading", async () => {
    vi.mocked(apiUpload).mockReset();
    vi.mocked(api.get).mockResolvedValue(profile({ directoryVisible: true }));
    await render(<PublicProfileCard />);
    const input = container.querySelector<HTMLInputElement>("input[type=file]");
    const user = userEvent.setup({ applyAccept: false });
    await act(async () =>
      user.upload(input as HTMLInputElement, new File(["x"], "cv.png", { type: "image/png" })),
    );
    expect(apiUpload).not.toHaveBeenCalled();
    expect(container.querySelector("[role=alert]")?.textContent).toBe("cvFileHint");
  });

  it("previews the server card until something changes", async () => {
    vi.mocked(api.get).mockResolvedValue(
      profile({ directoryVisible: true }, { displayName: "Server Card" }),
    );
    await render(<PublicProfileCard />);
    expect(container.textContent).toContain("Server Card");

    const user = userEvent.setup();
    await act(async () => user.click(byLabel("publicProfileShowSurname") as HTMLButtonElement));
    expect(container.textContent).toContain("María José Fernández-Villaverde");
  });
});

describe("displayName", () => {
  it("abbreviates the surname by code point, like the API", () => {
    expect(displayName({ name: " Ada ", surname: " 𝒵eta " }, false)).toBe("Ada 𝒵.");
    expect(displayName({ name: "Ada", surname: "  " }, false)).toBe("Ada");
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
    bio: null,
    locationNote: null,
    socials: [],
    cvUrl: null,
    project: null,
    challenges: [],
  };

  it("shows only the name when nothing else is public", () => {
    act(() => root.render(<DirectoryCard entry={entry} />));
    expect(container.querySelector("ul")).toBeNull();
    expect(container.textContent).toBe("MFMaría José F.");
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

  it("shows the bio, links and CV through the authenticated API", () => {
    act(() =>
      root.render(
        <DirectoryCard
          entry={{
            ...entry,
            photoUrl: "/api/users/7/photo?v=abc",
            bio: "Line one\nLine two",
            socials: [{ kind: "github", url: "https://github.com/maria/" }],
            cvUrl: "/api/directory/7/cv",
          }}
        />,
      ),
    );
    expect(container.textContent).toContain("Line one\nLine two");
    const link = container.querySelector<HTMLAnchorElement>("a[href='https://github.com/maria/']");
    expect(link?.textContent).toBe("socialGithub: github.com/maria");
    expect(link?.rel).toContain("noopener");
    expect(
      container.querySelector<HTMLAnchorElement>(`a[href='${API_URL}/api/directory/7/cv']`)
        ?.textContent,
    ).toBe("downloadCv");
  });
});
