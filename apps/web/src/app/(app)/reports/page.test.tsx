import userEvent from "@testing-library/user-event";
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

const session = vi.hoisted(() => ({ caps: new Set<string>() }));
const resource = vi.hoisted(() => ({ data: null as unknown, reload: vi.fn() }));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/reports",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/session", () => ({
  useSessionContext: () => ({ can: (capability: string) => session.caps.has(capability) }),
}));
vi.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {},
  api: { get: vi.fn(), patch: vi.fn() },
}));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/i18n", () => ({ useLocale: () => ({ language: "en", t: (key: string) => key }) }));
vi.mock("@/hooks/use-server-resource", () => ({
  useServerResource: () => ({
    data: resource.data,
    error: null,
    loading: false,
    reload: resource.reload,
  }),
}));
vi.mock("@/components/common/page-layout", () => ({
  PageLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/common/page-header", () => ({ PageHeader: () => null }));
vi.mock("@/components/common/access-denied", () => ({
  AccessDenied: () => <p>denied</p>,
}));

import { api } from "@/lib/api";
import ReportsPage from "./page";

const report = {
  id: 4,
  kind: "project",
  reason: "spam",
  details: "advertising",
  status: "open",
  createdAt: "2026-10-18T10:00:00.000Z",
  reporter: { id: 9, name: "Ana", surname: "Pérez" },
  project: { id: 12, name: "Rover" },
  person: null,
};

describe("Reports inbox (H18)", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    session.caps = new Set(["projects:edit"]);
    resource.data = { items: [report] };
    vi.mocked(api.patch).mockResolvedValue({});
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  const render = () => act(async () => root.render(<ReportsPage />));
  const button = (label: string) =>
    [...container.querySelectorAll("button")].find((b) => b.textContent === label) as HTMLElement;

  it("shows who reported which content and why", async () => {
    await render();
    expect(container.textContent).toContain("Rover");
    expect(container.textContent).toContain("advertising");
    expect(container.textContent).toContain("Ana Pérez");
    expect(container.querySelector('a[href="/projects/12"]')).not.toBeNull();
  });

  it("closes an open report as handled or dismissed", async () => {
    const user = userEvent.setup();
    await render();
    await user.click(button("reportMarkHandled"));
    expect(api.patch).toHaveBeenCalledWith("/api/content-reports/4", { status: "actioned" });
    expect(resource.reload).toHaveBeenCalled();
    await user.click(button("dismiss"));
    expect(api.patch).toHaveBeenLastCalledWith("/api/content-reports/4", { status: "dismissed" });
  });

  it("is closed to people who can edit neither projects nor users", async () => {
    session.caps = new Set();
    await render();
    expect(container.textContent).toBe("denied");
  });
});
