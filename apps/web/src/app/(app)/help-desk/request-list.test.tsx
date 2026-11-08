import userEvent from "@testing-library/user-event";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "@/lib/api";
import type { HelpRequest } from "./model";
import { RequestRow } from "./request-list";

vi.mock("@/lib/i18n", () => ({
  useLocale: () => ({
    language: "en",
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key} ${JSON.stringify(values)}` : key,
  }),
}));
vi.mock("@/lib/api", () => ({
  api: { post: vi.fn() },
  ApiError: class extends Error {
    constructor(
      public status: number,
      public code: string,
      message: string,
      public details?: unknown,
    ) {
      super(message);
    }
  },
}));
const request: HelpRequest = {
  id: 9,
  status: "open",
  description: "Debug Angular",
  location: "Table 12",
  topics: [{ id: 1, name: "Frontend" }],
  other: false,
  project: null,
  requester: { userId: 1, displayName: "Ana" },
  routing: "matched",
  notifiedCount: 1,
  claim: null,
  createdAt: "2027-02-27T10:00:00Z",
  resolvedAt: null,
  cancelledAt: null,
  viewer: {
    canClaim: true,
    canCancel: false,
    canRelease: false,
    canResolve: false,
    notified: true,
  },
};
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
describe("claiming help (H66)", () => {
  it("claims on the way with no fabricated destination and prevents repeated requests while pending", async () => {
    let complete: (value: unknown) => void = () => {};
    vi.mocked(api.post).mockReturnValue(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    const reload = vi.fn();
    const onClaimed = vi.fn();
    await act(async () =>
      root.render(<RequestRow request={request} reload={reload} onClaimed={onClaimed} />),
    );
    const button = container.querySelector<HTMLButtonElement>("button[type=submit]")!;
    await act(async () => userEvent.click(button));
    expect(button.disabled).toBe(true);
    expect(api.post).toHaveBeenCalledWith("/api/helpdesk/requests/9/claim", { mode: "on_my_way" });
    await act(async () => {
      complete({});
    });
    expect(reload).toHaveBeenCalledOnce();
    expect(onClaimed).toHaveBeenCalledOnce();
  });
  it("keeps a visible conflict and refreshes the request when another helper wins", async () => {
    vi.mocked(api.post).mockRejectedValue(
      new ApiError(409, "conflict", "Already claimed", { code: "help_request_already_claimed" }),
    );
    const reload = vi.fn();
    await act(async () => root.render(<RequestRow request={request} reload={reload} />));
    await act(async () => userEvent.click(container.querySelector("button[type=submit]")!));
    expect(container.querySelector("[role=alert]")?.textContent).toContain("helpDeskClaimConflict");
    expect(reload).toHaveBeenCalledOnce();
  });
  it("renders removed identities safely and retains destination instructions", async () => {
    await act(async () =>
      root.render(
        <RequestRow
          request={{
            ...request,
            status: "claimed",
            requester: null,
            claim: {
              helper: null,
              mode: "meet_at",
              meetingLocation: "Sponsor stand",
              claimedAt: request.createdAt,
            },
            viewer: { ...request.viewer, canClaim: false },
          }}
          reload={vi.fn()}
        />,
      ),
    );
    expect(container.textContent).toContain("helpDeskRemovedAccount");
    expect(container.textContent).toContain("Sponsor stand");
    expect(container.querySelector("button[type=submit]")).toBeNull();
  });
});
