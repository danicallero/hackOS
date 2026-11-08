import userEvent from "@testing-library/user-event";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "@/lib/api";
import type { HelpRequest } from "./model";
import { RequestDetail } from "./request-list";

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
  challenge: null,
  preferSponsor: false,
  notifiedCount: 1,
  claim: null,
  createdAt: "2027-02-27T10:00:00Z",
  resolvedAt: null,
  cancelledAt: null,
  queuedAt: "2027-02-27T10:00:00Z",
  queuePosition: null,
  viewer: {
    canEdit: false,
    canClaim: true,
    canCancel: false,
    canRelease: false,
    canResolve: false,
    notified: true,
  },
};
let root: Root, container: HTMLDivElement;
/** Opens the claim dialog and returns its submit button. */
async function openClaim() {
  const trigger = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "helpDeskClaim",
  )!;
  await act(async () => userEvent.click(trigger));
  return document.querySelector<HTMLButtonElement>("[role=dialog] button[type=submit]")!;
}
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
      root.render(<RequestDetail request={request} reload={reload} onClaimed={onClaimed} />),
    );
    const button = await openClaim();
    await act(async () => button.click());
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
    await act(async () => root.render(<RequestDetail request={request} reload={reload} />));
    const submit = await openClaim();
    await act(async () => submit.click());
    expect(document.body.textContent).toContain("helpDeskClaimConflict");
    expect(reload).toHaveBeenCalledOnce();
  });
  it("renders removed identities safely and retains destination instructions", async () => {
    await act(async () =>
      root.render(
        <RequestDetail
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
    expect([...container.querySelectorAll("button")].map((b) => b.textContent)).not.toContain(
      "helpDeskClaim",
    );
  });
  it("links the claiming helper's name to their profile", async () => {
    await act(async () =>
      root.render(
        <RequestDetail
          request={{
            ...request,
            status: "claimed",
            claim: {
              helper: {
                userId: 7,
                displayName: "Bea",
                photoUrl: null,
                kind: "mentor",
                visibleRoleName: "Mentor",
                affiliation: null,
              },
              mode: "on_my_way",
              meetingLocation: null,
              claimedAt: request.createdAt,
            },
            viewer: { ...request.viewer, canClaim: false },
          }}
          reload={vi.fn()}
        />,
      ),
    );
    const link = container.querySelector('a[href="/help-desk/helpers/7"]');
    expect(link?.textContent).toBe("Bea");
  });
  it("shows the challenge and the sponsor preference", async () => {
    await act(async () =>
      root.render(
        <RequestDetail
          request={{
            ...request,
            routing: "sponsor",
            challenge: { id: 4, name: "Best use of Postgres" },
            preferSponsor: true,
          }}
          reload={vi.fn()}
        />,
      ),
    );
    expect(container.textContent).toContain("Best use of Postgres");
    expect(container.textContent).toContain("helpDeskSponsorPreferred");
    expect(container.textContent).not.toContain("helpDeskFallback");
  });
  it("links the requester to their public profile only when one is shared", async () => {
    const entry = { userId: 1, displayName: "Ana" } as NonNullable<HelpRequest["requesterProfile"]>;
    await act(async () =>
      root.render(
        <RequestDetail request={{ ...request, requesterProfile: entry }} reload={vi.fn()} />,
      ),
    );
    expect(container.querySelector('a[href="/help-desk/requests/9/requester"]')?.textContent).toBe(
      "Ana",
    );
    await act(async () =>
      root.render(
        <RequestDetail request={{ ...request, requesterProfile: null }} reload={vi.fn()} />,
      ),
    );
    expect(container.querySelector('a[href="/help-desk/requests/9/requester"]')).toBeNull();
  });
  it("offers Edit only to the requester of an editable request and shows its queue place", async () => {
    const labels = () => [...container.querySelectorAll("button")].map((b) => b.textContent);
    await act(async () =>
      root.render(
        <RequestDetail
          request={{ ...request, queuePosition: 3, viewer: { ...request.viewer, canEdit: true } }}
          reload={vi.fn()}
        />,
      ),
    );
    expect(labels()).toContain("helpDeskEdit");
    expect(container.textContent).toContain("helpDeskQueuePosition");
    await act(async () => root.render(<RequestDetail request={request} reload={vi.fn()} />));
    expect(labels()).not.toContain("helpDeskEdit");
  });
});
