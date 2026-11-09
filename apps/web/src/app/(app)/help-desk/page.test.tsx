import { CAPABILITIES } from "@hackos/shared/capabilities";
import { getByRole, queryByRole } from "@testing-library/dom";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HelpdeskPage from "./page";

const env = vi.hoisted(() => ({
  caps: [] as string[],
  eligible: true,
  loading: false,
  error: null as unknown,
  path: "/help-desk",
  search: "",
  replace: vi.fn(),
  reload: vi.fn(),
  reads: [] as string[],
}));
vi.mock("next/navigation", () => ({
  usePathname: () => env.path,
  useSearchParams: () => new URLSearchParams(env.search),
  useRouter: () => ({ replace: env.replace }),
}));
vi.mock("@/lib/i18n", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
vi.mock("@/lib/session", () => ({
  useSessionContext: () => ({
    can: (cap: string) => env.caps.includes(cap),
    canAny: (...caps: string[]) => caps.some((cap) => env.caps.includes(cap)),
  }),
}));
vi.mock("@/hooks/use-own-helper-profile", () => ({
  useOwnHelperProfile: () => ({
    data: env.loading ? undefined : { eligible: env.eligible },
    loading: env.loading,
    error: env.error,
    reload: env.reload,
  }),
}));
vi.mock("@/components/common/section-navigation", () => ({
  HelpDeskSectionHeader: () => <h1>Help desk</h1>,
}));
vi.mock("./shared", () => ({
  HelpdeskLoading: () => <span>Loading</span>,
  HelpdeskError: ({ retry }: { retry: () => void }) => (
    <button type="button" onClick={retry}>
      Retry profile
    </button>
  ),
  useHelpdesk: (_key: unknown, path: string, enabled: boolean) => {
    if (enabled) env.reads.push(path);
    return { data: enabled ? { requests: [] } : undefined, refetch: env.reload };
  },
}));
vi.mock("./request-list", () => ({
  RequestTable: ({
    audience,
    onClaimed,
    returnHref,
  }: {
    audience: string;
    onClaimed: () => void;
    returnHref: string;
  }) => (
    <div>
      <span>{audience}</span>
      <a href={returnHref}>Return context</a>
      <button type="button" onClick={onClaimed}>
        Claim
      </button>
    </div>
  ),
}));
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(env, {
    caps: [],
    eligible: true,
    loading: false,
    error: null,
    path: "/help-desk",
    search: "",
    reads: [],
  });
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
const render = () => act(async () => root.render(<HelpdeskPage />));
describe("unified Help desk (H64-H66)", () => {
  it("offers all three views to an eligible requester/helper and switches queries without redirecting", async () => {
    env.caps = [CAPABILITIES.HELPDESK_REQUEST, CAPABILITIES.HELPDESK_OFFER];
    await render();
    expect(env.reads.at(-1)).toBe("/api/helpdesk/requests/mine");
    expect(container.querySelectorAll("[role=tab]")).toHaveLength(3);
    expect(env.replace).not.toHaveBeenCalled();
    await act(async () =>
      userEvent.click(getByRole(container, "tab", { name: "helpDeskOpenRequests" })),
    );
    expect(env.reads.at(-1)).toBe("/api/helpdesk/inbox?scope=open");
    expect(env.replace).toHaveBeenLastCalledWith("/help-desk?tab=open", { scroll: false });
    const tab = getByRole(container, "tab", { name: "helpDeskOpenRequests" });
    expect(document.getElementById(tab.getAttribute("aria-controls")!)?.getAttribute("role")).toBe(
      "tabpanel",
    );
    await act(async () => userEvent.click(getByRole(container, "button", { name: "Claim" })));
    expect(env.reads.at(-1)).toBe("/api/helpdesk/inbox?scope=mine");
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/help-desk?tab=claims");
  });
  it.each([
    "/help-desk",
    "/help-desk/inbox",
    "/help-desk/requests",
  ])("restores a claims deep link on %s without rewriting it", async (path) => {
    env.caps = [CAPABILITIES.HELPDESK_REQUEST, CAPABILITIES.HELPDESK_OFFER];
    env.path = path;
    env.search = "tab=claims";
    await render();
    expect(
      getByRole(container, "tab", { name: "helpDeskAssigned" }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(env.reads.at(-1)).toBe("/api/helpdesk/inbox?scope=mine");
    expect(env.replace).not.toHaveBeenCalled();
  });
  it("keeps the legacy inbox entry on open and follows external URL changes", async () => {
    env.caps = [CAPABILITIES.HELPDESK_REQUEST, CAPABILITIES.HELPDESK_OFFER];
    env.path = "/help-desk/inbox";
    await render();
    expect(env.reads.at(-1)).toBe("/api/helpdesk/inbox?scope=open");
    env.search = "tab=mine";
    await render();
    expect(env.reads.at(-1)).toBe("/api/helpdesk/requests/mine");
  });
  it("requires eligibility as well as offer capability, and recovers when eligibility loads", async () => {
    env.caps = [CAPABILITIES.HELPDESK_REQUEST, CAPABILITIES.HELPDESK_OFFER];
    env.eligible = false;
    env.search = "tab=claims";
    await render();
    expect(queryByRole(container, "tab", { name: "helpDeskOpenRequests" })).toBeNull();
    expect(env.reads.at(-1)).toBe("/api/helpdesk/requests/mine");
    env.eligible = true;
    await render();
    expect(env.reads.at(-1)).toBe("/api/helpdesk/inbox?scope=mine");
  });
  it("does not expose request queries to a coverage-only viewer", async () => {
    env.caps = [CAPABILITIES.HELPDESK_COVERAGE];
    await render();
    expect(env.reads).toEqual([]);
  });
  it("denies callers without capabilities and exposes profile retry failures", async () => {
    await render();
    expect(container.textContent).toContain("noAccessTitle");
    expect(env.reads).toEqual([]);
    env.caps = [CAPABILITIES.HELPDESK_OFFER];
    env.error = new Error("offline");
    await render();
    await act(async () =>
      userEvent.click(getByRole(container, "button", { name: "Retry profile" })),
    );
    expect(env.reload).toHaveBeenCalledOnce();
  });
});
