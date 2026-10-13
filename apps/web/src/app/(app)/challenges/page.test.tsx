import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const state = vi.hoisted(() => ({ nonce: 0 }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/challenges",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/i18n", () => {
  const value = { t: (key: string) => key, language: "en" };
  return {
    LOCALE_CODES: { es: "es-ES", gl: "gl-ES", en: "en-GB" },
    useLocale: () => value,
  };
});
vi.mock("@/lib/session", () => ({
  useSessionContext: () => ({ canAny: () => true, me: { isSponsorRep: false } }),
}));
vi.mock("@/hooks/use-auto-refresh", () => ({ useAutoRefresh: () => state.nonce }));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
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
  api: { get: vi.fn(), post: vi.fn() },
}));

import { ApiError, api } from "@/lib/api";
import ChallengesPage from "./page";

const challenge = (id: number) => ({
  id,
  title: `Challenge ${id}`,
  description: "",
  criteria: "",
  visibility: "visible",
  available_from: null,
  enterprise_name: null,
});

describe("ChallengesPage background refresh (#1012)", () => {
  let container: HTMLDivElement;
  let root: Root;

  async function render() {
    await act(async () => {
      root.render(<ChallengesPage />);
    });
  }
  async function refresh() {
    state.nonce += 1;
    await render();
  }

  beforeEach(() => {
    state.nonce = 0;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.mocked(api.get).mockReset();
  });

  it("keeps the list and selection and marks it stale when a refresh gets a 429", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ challenges: [challenge(1), challenge(2)] });
    await render();
    expect(container.textContent).toContain("Challenge 1");

    const boxes = container.querySelectorAll<HTMLElement>('[role="checkbox"]');
    await act(async () => boxes[1]?.click());
    expect(container.textContent).toContain("selectedCount");

    vi.mocked(api.get).mockRejectedValueOnce(new ApiError(429, "rate_limited", "Slow down"));
    await refresh();

    expect(container.textContent).toContain("Challenge 1");
    expect(container.textContent).toContain("Challenge 2");
    expect(container.textContent).toContain("selectedCount");
    expect(container.textContent).toContain("staleDataNotice");
    expect(container.textContent).not.toContain("Slow down");
  });

  it("keeps the selection across a successful refresh and drops deleted rows", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ challenges: [challenge(1), challenge(2)] });
    await render();
    const boxes = container.querySelectorAll<HTMLElement>('[role="checkbox"]');
    await act(async () => boxes[1]?.click());
    await act(async () => boxes[2]?.click());

    vi.mocked(api.get).mockResolvedValueOnce({ challenges: [challenge(1)] });
    await refresh();

    expect(container.textContent).not.toContain("Challenge 2");
    expect(container.textContent).toContain("selectedCount");
  });

  it("shows the error only when the first load fails", async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new ApiError(429, "rate_limited", "Slow down"));
    await render();
    expect(container.textContent).toContain("Slow down");
    expect(container.textContent).not.toContain("staleDataNotice");
  });
});
