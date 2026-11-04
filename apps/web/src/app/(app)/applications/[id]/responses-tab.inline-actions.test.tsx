import userEvent from "@testing-library/user-event";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResponseRow } from "@/lib/applications";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  toastAction: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock("@/lib/api", () => ({
  api: { get: mocks.get, post: mocks.post },
  ApiError: class ApiError extends Error {
    status = 0;
  },
}));
vi.mock("@/lib/toast", () => ({
  toast: { action: mocks.toastAction, success: mocks.toastSuccess, error: mocks.toastError },
}));
vi.mock("@/lib/session", () => ({
  useCan: () => true,
  useMe: () => ({ id: 1 }),
}));
// `t` must be referentially stable: the tab's load effect depends on it.
const i18n = vi.hoisted(() => {
  const t = (key: string, values: Record<string, string | number> = {}) =>
    Object.entries(values).reduce((text, [k, v]) => text.replace(`{${k}}`, String(v)), key);
  return { value: { language: "en", t }, pickText: (v: unknown) => String(v) };
});
vi.mock("@/lib/i18n", () => ({ pickText: i18n.pickText, useLocale: () => i18n.value }));
vi.mock("@/hooks/use-auto-refresh", () => ({ useAutoRefresh: () => 0 }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/components/applications/review-modal", () => ({ ReviewModal: () => null }));
vi.mock("@/components/applications/application-export-panel", () => ({
  ApplicationExportPanel: () => null,
}));
vi.mock("./send-decisions-modal", () => ({ SendDecisionsModal: () => null }));

import { ResponsesTab } from "./responses-tab";

function makeRow(id: number, status = "review"): ResponseRow {
  return {
    id,
    user_id: id,
    name: `Applicant ${id}`,
    email: `a${id}@example.com`,
    shirt_size: null,
    food_intolerances: [],
    food_intolerance_notes: null,
    status,
    responses: {},
    staff_notes: null,
    submitted_at: "2026-10-01T10:00:00Z",
    decision_sent_at: null,
    confirmation_expires_at: null,
    confirmed_at: null,
    declined_at: null,
    avg_score: null,
    review_count: 0,
    reviews: [],
  };
}

describe("inline row actions on the responses list", () => {
  let container: HTMLDivElement;
  let root: Root;
  let server: ResponseRow[];

  beforeEach(() => {
    mocks.get.mockReset();
    mocks.post.mockReset();
    mocks.toastAction.mockReset();
    mocks.toastSuccess.mockReset();
    mocks.toastError.mockReset();
    server = Array.from({ length: 12 }, (_, i) => makeRow(i + 1));
    mocks.get.mockImplementation(async () => ({ responses: structuredClone(server) }));
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function mount(workspace: "review" | "outbox" = "review") {
    await act(async () => {
      root.render(
        <ResponsesTab
          id={7}
          template={[]}
          sections={[]}
          askShirtSize={false}
          askFoodIntolerances={false}
          workspace={workspace}
        />,
      );
    });
    await vi.waitFor(() => expect(container.querySelector("[data-row-actions]")).not.toBeNull(), {
      timeout: 2000,
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
  }

  const button = (label: string) =>
    container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);

  it("accepts from the row, shows the marker and offers Undo", async () => {
    await mount();
    expect(container.querySelectorAll("table [data-row-actions]").length).toBe(12);
    mocks.post.mockResolvedValue({});
    server[0] = makeRow(1, "accepted_internal");

    await act(async () => {
      button("accept: Applicant 1")?.click();
    });

    expect(mocks.post).toHaveBeenCalledWith("/api/responses/1/decide", { decision: "accepted" });
    expect(container.textContent).toContain("acceptedInternalOnly");
    expect(mocks.toastAction).toHaveBeenCalledWith(
      "acceptedUnsentToast",
      expect.objectContaining({ action: expect.objectContaining({ label: "undo" }) }),
    );
  });

  it("rolls the row back and reports a business error", async () => {
    await mount();
    mocks.post.mockRejectedValue(new Error("Already decided"));

    await act(async () => {
      button("reject: Applicant 2")?.click();
    });

    expect(mocks.toastError).toHaveBeenCalled();
    expect(button("reject: Applicant 2")).not.toBeNull();
    expect(button("accept: Applicant 2")).not.toBeNull();
  });

  it("sends one request for a double click", async () => {
    await mount();
    let release: (value: unknown) => void = () => {};
    mocks.post.mockImplementation(() => new Promise((resolve) => (release = resolve)));
    const target = button("accept: Applicant 3");

    await act(async () => {
      target?.click();
      target?.click();
    });
    await act(async () => release({}));

    const decides = mocks.post.mock.calls.filter(([path]) => path === "/api/responses/3/decide");
    expect(decides).toHaveLength(1);
  });

  it("is reachable and operable from the keyboard", async () => {
    await mount();
    mocks.post.mockResolvedValue({});
    const user = userEvent.setup();
    const accept = button("accept: Applicant 4");
    expect(accept?.tagName).toBe("BUTTON");
    expect(accept?.getAttribute("tabindex")).not.toBe("-1");

    await act(async () => {
      accept?.focus();
      await user.keyboard("{Enter}");
    });

    expect(mocks.post).toHaveBeenCalledWith("/api/responses/4/decide", { decision: "accepted" });
  });

  it("offers Send in the outbox without a decide action", async () => {
    server = [makeRow(1, "accepted_internal"), makeRow(2, "rejected_internal")];
    await mount("outbox");
    mocks.post.mockResolvedValue({});
    expect(button("accept: Applicant 1")).toBeNull();

    await act(async () => {
      button("send: Applicant 1")?.click();
    });

    expect(mocks.post).toHaveBeenCalledWith("/api/responses/1/send-decision");
    expect(mocks.toastSuccess).toHaveBeenCalled();
  });
});
