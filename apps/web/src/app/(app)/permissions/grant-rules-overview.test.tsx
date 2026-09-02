import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RoleGrantRule } from "@/lib/types";
import { GrantRulesOverviewModal } from "./grant-rules-overview";

// H8 follow-up: "view all rules" should let an admin navigate to the rule
// they clicked (its owning role's Grant Rules tab, wired in page.tsx). This
// suite only exercises that click -> onSelectRule callback, not page.tsx's
// routing, which the component deliberately doesn't own itself.

const rules: RoleGrantRule[] = [
  {
    id: 1,
    roleId: 42,
    roleName: "Organizer",
    triggerEvent: null,
    sourceRoleId: 7,
    sourceRoleName: "Event Director",
    action: "grant",
    enabled: true,
    enterpriseId: null,
    enterpriseName: null,
  },
  {
    id: 2,
    roleId: 9,
    roleName: "Sponsor",
    triggerEvent: "sponsor.enterprise_linked",
    sourceRoleId: null,
    sourceRoleName: null,
    action: "grant",
    enabled: true,
    enterpriseId: null,
    enterpriseName: null,
  },
];

vi.mock("@/lib/api", () => ({
  api: {
    get: vi.fn(() => Promise.resolve(rules)),
  },
  ApiError: class ApiError extends Error {},
}));

// Mimics the real catalogue entry ("{roleName} is assigned") closely enough
// to exercise interpolation without importing the JSON locale; every other
// key just echoes back so assertions can match on the raw key.
const t = (key: string, values?: Record<string, string | number>) => {
  const template = key === "triggerSourceRoleAssigned" ? "{roleName} is assigned" : key;
  return values
    ? Object.entries(values).reduce((s, [k, v]) => s.replace(`{${k}}`, String(v)), template)
    : template;
};
vi.mock("@/lib/i18n", () => ({
  useLocale: () => ({ t }),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// jsdom has no ResizeObserver; radix-ui's internal size hook uses one.
class StubResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as typeof globalThis & { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
  StubResizeObserver as unknown as typeof ResizeObserver;

describe("GrantRulesOverviewModal row navigation", () => {
  let container: HTMLDivElement;
  let root: Root;
  let onSelectRule: (rule: RoleGrantRule) => void;
  let onOpenChange: (open: boolean) => void;

  beforeEach(async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    onSelectRule = vi.fn();
    onOpenChange = vi.fn();

    await act(async () => {
      root.render(
        <GrantRulesOverviewModal open onOpenChange={onOpenChange} onSelectRule={onSelectRule} />,
      );
    });
    // Flush the load() effect's api.get promise.
    await act(async () => {
      await Promise.resolve();
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("calls onSelectRule with the clicked rule", async () => {
    const buttons = [...document.body.querySelectorAll("button")];
    const eventDirectorRow = buttons.find((b) => b.textContent?.includes("Event Director"));
    if (!eventDirectorRow) throw new Error("row for the Event Director rule not found");

    await act(async () => eventDirectorRow.click());

    expect(onSelectRule).toHaveBeenCalledTimes(1);
    expect(onSelectRule).toHaveBeenCalledWith(expect.objectContaining({ id: 1, roleId: 42 }));
  });

  it("renders a role-assignment-triggered rule's label from its source role, not a raw trigger_event", () => {
    expect(document.body.textContent).toContain("Event Director is assigned");
  });

  it("still renders a domain trigger_event rule's translated label", () => {
    expect(document.body.textContent).toContain("triggerEventSponsorEnterpriseLinked");
  });
});
