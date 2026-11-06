import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
const state = vi.hoisted(() => ({
  remove: vi.fn(),
  refetch: vi.fn(),
  responses: [
    {
      id: 1,
      application_id: 10,
      application_name: "Hacker",
      status: "draft",
      submitted_at: null,
      can_delete_draft: true,
    },
    {
      id: 2,
      application_id: 11,
      application_name: "Mentor",
      status: "review",
      submitted_at: "2026-11-01",
      can_delete_draft: false,
    },
    {
      id: 3,
      application_id: 12,
      application_name: "Returned",
      status: "draft",
      submitted_at: null,
      can_delete_draft: false,
    },
  ],
}));
vi.mock("@/lib/api", () => ({ api: { delete: state.remove } }));
vi.mock("@/hooks/use-live-query", () => ({
  useLiveQuery: (
    _fetcher: unknown,
    _scope: unknown,
    _events: unknown,
    options: { resourceKey: string[] },
  ) => ({
    data:
      options.resourceKey[0] === "me-applications"
        ? { responses: state.responses }
        : { applications: [] },
    loading: false,
    error: null,
    refetch: state.refetch,
  }),
}));
vi.mock("@/lib/i18n", () => ({
  LOCALE_CODES: { en: "en-US" },
  useLocale: () => ({ language: "en", t: (key: string) => key }),
}));
vi.mock("@/lib/api-error-text", () => ({ apiErrorText: () => "Deletion failed" }));
vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props}>{children}</a>
  ),
}));
vi.mock("@/components/common/page-layout", () => ({
  PageLayout: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock("@/components/common/page-header", () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

import MyApplicationsPage from "./page";

describe("discard application draft (H12)", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(async () => {
    vi.resetAllMocks();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(<MyApplicationsPage />));
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });
  const buttons = () =>
    [...document.querySelectorAll<HTMLButtonElement>("button")].filter(
      (b) => b.textContent === "deleteApplicationDraft",
    );

  it("offers deletion only for never-submitted drafts and requires confirmation", async () => {
    expect(buttons()).toHaveLength(1);
    const actionable = container.querySelector('a[href="/my-applications/10"]');
    expect(actionable?.textContent).not.toContain("dataStatusDraft");
    const returned = container.querySelector('a[href="/my-applications/12"]');
    expect(returned?.textContent).toContain("dataStatusDraft");
    expect(container.querySelector('a[href="/my-applications/11"]')?.textContent).toContain(
      "dataStatusReview",
    );
    expect(container.querySelector('a[href="/my-applications/11"]')).not.toBeNull();
    await act(async () => buttons()[0]?.click());
    expect(state.remove).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    await act(async () => buttons().at(-1)?.click());
    expect(state.remove).toHaveBeenCalledWith("/api/applications/10/response");
    expect(state.refetch).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it("keeps the draft and dialog on failure and allows retry", async () => {
    state.remove.mockRejectedValueOnce(new Error("offline"));
    await act(async () => buttons()[0]?.click());
    await act(async () => buttons().at(-1)?.click());
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain(
      "Deletion failed",
    );
    expect(state.refetch).not.toHaveBeenCalled();
    state.remove.mockResolvedValueOnce(undefined);
    await act(async () => buttons().at(-1)?.click());
    expect(state.refetch).toHaveBeenCalledOnce();
  });

  it("cancels without deleting", async () => {
    await act(async () => buttons()[0]?.click());
    const cancel = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => b.textContent === "cancel",
    );
    await act(async () => cancel?.click());
    expect(state.remove).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });
});
