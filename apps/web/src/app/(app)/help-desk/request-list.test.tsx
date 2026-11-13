import { getByLabelText, getByRole } from "@testing-library/dom";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "@/lib/api";
import type { HelpRequest } from "./model";
import { RequestDetail, RequestTable } from "./request-list";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }) }));
vi.mock("@/components/common/user-avatar", () => ({
  UserAvatar: ({ image }: { image: string }) => <span data-photo={image} />,
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));

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
  it.each([
    ["open", "2027-02-27T10:00:00Z"],
    ["claimed", "2027-02-27T11:00:00Z"],
    ["resolved", "2027-02-27T12:00:00Z"],
    ["cancelled", "2027-02-27T13:00:00Z"],
  ] as const)("shows the %s state timestamp and helper identity", async (status, expected) => {
    await act(async () =>
      root.render(
        <RequestDetail
          request={{
            ...request,
            status,
            resolvedAt: "2027-02-27T12:00:00Z",
            cancelledAt: "2027-02-27T13:00:00Z",
            claim: {
              helper: {
                userId: 7,
                displayName: "Bea",
                photoUrl: "/bea.jpg",
                kind: "mentor",
                visibleRoleName: "Mentor",
                affiliation: "Acme",
              },
              mode: "meet_at",
              meetingLocation: "Stand",
              claimedAt: "2027-02-27T11:00:00Z",
            },
          }}
          reload={vi.fn()}
        />,
      ),
    );
    expect(container.querySelector("time")?.getAttribute("datetime")).toBe(expected);
    const helper = getByRole(container, "region", { name: "helpDeskHelperColumn" });
    expect(helper.textContent).toContain("Mentor · Acme");
    expect(helper.querySelector("[data-photo]")?.getAttribute("data-photo")).toBe("/bea.jpg");
    expect(getByRole(helper, "link").getAttribute("href")).toBe("/help-desk/helpers/7");
  });
  it.each([
    "release",
    "resolve",
    "cancel",
  ] as const)("performs %s once and refreshes after success", async (action) => {
    vi.mocked(api.post).mockResolvedValue({});
    const reload = vi.fn();
    await act(async () =>
      root.render(
        <RequestDetail
          request={{
            ...request,
            viewer: {
              ...request.viewer,
              canClaim: false,
              canRelease: action === "release",
              canResolve: action === "resolve",
              canCancel: action === "cancel",
            },
          }}
          reload={reload}
        />,
      ),
    );
    const label = `helpDesk${action[0].toUpperCase()}${action.slice(1)}`;
    await act(async () => userEvent.click(getByRole(container, "button", { name: label })));
    if (action === "cancel")
      await act(async () =>
        userEvent.click(
          getByRole(document.querySelector("[role=alertdialog]") as HTMLElement, "button", {
            name: label,
          }),
        ),
      );
    expect(api.post).toHaveBeenCalledWith(`/api/helpdesk/requests/9/${action}`);
    expect(reload).toHaveBeenCalledOnce();
  });

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
  it("claims at an explicit destination and trims the meeting location", async () => {
    vi.mocked(api.post).mockResolvedValue({});
    await act(async () => root.render(<RequestDetail request={request} reload={vi.fn()} />));
    await openClaim();
    await act(async () =>
      userEvent.click(getByRole(document.body, "radio", { name: "helpDeskMeetAt" })),
    );
    await act(async () =>
      userEvent.type(getByLabelText(document.body, "helpDeskDestination"), "  Sponsor stand  "),
    );
    await act(async () =>
      userEvent.click(
        document.querySelector<HTMLButtonElement>("[role=dialog] button[type=submit]")!,
      ),
    );
    expect(api.post).toHaveBeenCalledExactlyOnceWith("/api/helpdesk/requests/9/claim", {
      mode: "meet_at",
      meetingLocation: "Sponsor stand",
    });
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
  it("preserves the request list while opening the helper and requester profiles", async () => {
    const source = "/help-desk/inbox?tab=claims";
    await act(async () =>
      root.render(
        <RequestDetail
          source={source}
          request={{
            ...request,
            requesterProfile: { displayName: "Ana" } as NonNullable<
              HelpRequest["requesterProfile"]
            >,
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
          }}
          reload={vi.fn()}
        />,
      ),
    );
    const helper = getByRole(container, "region", { name: "helpDeskHelperColumn" });
    expect(getByRole(helper, "link").getAttribute("href")).toBe(
      `/help-desk/helpers/7?request=9&from=${encodeURIComponent(source)}`,
    );
    expect(getByRole(container, "link", { name: "Ana" }).getAttribute("href")).toBe(
      `/help-desk/requests/9/requester?from=${encodeURIComponent(source)}`,
    );
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

describe("request list parity (H64-H66)", () => {
  const resolved = {
    ...request,
    id: 10,
    status: "resolved" as const,
    description: "OAuth loop",
    challenge: { id: 4, name: "Data challenge" },
    viewer: { ...request.viewer, canClaim: false },
  };
  it("omits self identity and location in own requests", async () => {
    await act(async () =>
      root.render(
        <RequestTable requests={[request, resolved]} audience="requester" reload={vi.fn()} />,
      ),
    );
    expect(container.textContent).not.toContain("Ana");
    expect(container.textContent).not.toContain("Table 12");
    expect(container.textContent).not.toContain("helpDeskMyself");
    expect(container.textContent).toContain("helpDeskWaiting");
    await act(async () =>
      root.render(<RequestTable requests={[request]} audience="helper" reload={vi.fn()} />),
    );
    expect(container.textContent).toContain("Ana");
    expect(container.textContent).toContain("Table 12");
  });
  it("combines multiple statuses, challenge and search, then clears without losing menu focus", async () => {
    const user = userEvent.setup();
    await act(async () =>
      root.render(
        <RequestTable
          requests={[
            request,
            resolved,
            { ...request, id: 11, status: "cancelled", description: "Docker failed" },
          ]}
          audience="requester"
          reload={vi.fn()}
        />,
      ),
    );
    const tableText = () => container.querySelector("tbody")?.textContent ?? "";
    await act(async () => user.click(getByRole(document.body, "button", { name: "filtersLabel" })));
    await act(async () =>
      user.click(getByRole(document.body, "menuitem", { name: "helpDeskStatusColumn" })),
    );
    const waiting = getByRole(document.body, "menuitemcheckbox", { name: "helpDeskWaiting" });
    await act(async () => user.click(waiting));
    expect(document.activeElement).toBe(waiting);
    expect(
      getByRole(document.body, "menuitemcheckbox", { name: "helpDeskWaiting" }).getAttribute(
        "aria-checked",
      ),
    ).toBe("true");
    await act(async () =>
      user.click(getByRole(document.body, "menuitemcheckbox", { name: "helpDeskResolved" })),
    );
    expect(tableText()).toContain("Debug Angular");
    expect(tableText()).toContain("OAuth loop");
    expect(tableText()).not.toContain("Docker failed");
    await act(async () => user.click(getByRole(document.body, "menuitem", { name: "back" })));
    await act(async () =>
      user.click(getByRole(document.body, "menuitem", { name: /^helpDeskChallenge/ })),
    );
    await act(async () =>
      user.click(getByRole(document.body, "menuitemcheckbox", { name: "Data challenge" })),
    );
    expect(tableText()).toContain("OAuth loop");
    expect(tableText()).not.toContain("Debug Angular");
    await act(async () => user.keyboard("{Escape}"));
    await act(async () =>
      user.type(getByRole(container, "searchbox", { name: "helpDeskSearchRequests" }), "missing"),
    );
    expect(tableText()).toBe("");
    await act(async () =>
      user.click(getByRole(document.body, "button", { name: /^filtersLabel/ })),
    );
    await act(async () =>
      user.click(getByRole(document.body, "menuitem", { name: "clearFilters" })),
    );
    await act(async () =>
      user.clear(getByRole(container, "searchbox", { name: "helpDeskSearchRequests" })),
    );
    expect(tableText()).toContain("Docker failed");
    expect(tableText()).toContain("Debug Angular");
  });
});
