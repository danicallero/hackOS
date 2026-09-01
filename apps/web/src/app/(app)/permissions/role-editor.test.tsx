import userEvent from "@testing-library/user-event";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PermissionState, RoleSummary } from "@/lib/types";
import { RoleEditor } from "./role-editor";

// GrantRulesPanel (the Grant Rules tab's content) fetches its own data via
// `api`; this suite only exercises drill-down navigation, so stub the API
// surface it touches rather than pulling in a real fetch mock.
vi.mock("@/lib/api", () => ({
  api: {
    get: vi.fn((path: string) =>
      Promise.resolve(path.startsWith("/api/enterprises") ? { enterprises: [] } : []),
    ),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
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

// RoleEditor's tab/screen state comes from useUrlTab (next/navigation). A
// static mock is enough: useUrlTab keeps `tab` as local state seeded from the
// URL, so as long as the mocked searchParams never itself changes, clicking
// through the drill-down only exercises that local state — see
// src/lib/url-tab.ts.
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => "/permissions",
  useSearchParams: () => new URLSearchParams(),
}));

// Returns the raw message key (interpolating `{name}`-style values), which
// keeps assertions readable without hand-maintaining a translation table.
// `t` is a module-level constant (not created inside useLocale) so its
// identity is stable across renders — the real useLocale memoizes it the
// same way (useMemo), and GrantRulesPanel's data-loading effect depends on
// it transitively (via a useCallback keyed on `t`); an unstable mock `t`
// would re-fire that effect every render and hang the test in an infinite
// loop.
const t = (key: string, values?: Record<string, string | number>) =>
  values ? Object.entries(values).reduce((s, [k, v]) => s.replace(`{${k}}`, String(v)), key) : key;
vi.mock("@/lib/i18n", () => ({
  useLocale: () => ({ t }),
}));

const role: RoleSummary = {
  id: 1,
  name: "Judges",
  position: 100,
  isVisible: true,
  isProtected: false,
  isSeeded: false,
  capabilities: [{ capability: "users:read", state: "inherit" }],
  memberIds: [],
  deletedAt: null,
};

function buttonWithText(container: HTMLElement, text: string): HTMLButtonElement {
  const match = [...container.querySelectorAll("button")].find((b) => b.textContent === text);
  if (!match) throw new Error(`no button with text "${text}"`);
  return match;
}

describe("RoleEditor mobile drill-down", () => {
  let container: HTMLDivElement;
  let root: Root;
  let onBack: () => void;
  let onSaveCapabilities: (
    capabilities: { capability: string; state: PermissionState }[],
  ) => Promise<void>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    onBack = vi.fn();
    onSaveCapabilities = vi.fn().mockResolvedValue(undefined);

    act(() => {
      root.render(
        <RoleEditor
          role={role}
          users={new Map()}
          onSaveDetails={vi.fn().mockResolvedValue(undefined)}
          onSaveCapabilities={onSaveCapabilities}
          onAddMember={vi.fn().mockResolvedValue(undefined)}
          onRemoveMember={vi.fn().mockResolvedValue(undefined)}
          onDelete={vi.fn().mockResolvedValue(undefined)}
          searchUsers={vi.fn().mockResolvedValue([])}
          loadSeedDiff={vi.fn().mockRejectedValue(new Error("not seeded"))}
          onResetToDefault={vi.fn().mockResolvedValue(undefined)}
          mobile
          onBack={onBack}
        />,
      );
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("starts on the role screen with nav rows into Permissions, Members and Grant Rules", () => {
    expect(container.querySelector("h1")?.textContent).toBe("Judges");
    expect(() => buttonWithText(container, "capabilitiesLabel")).not.toThrow();
    expect(() => buttonWithText(container, "membersTitle")).not.toThrow();
    expect(() => buttonWithText(container, "grantRulesTitle")).not.toThrow();
  });

  it("walks list → role → grant rules → back", async () => {
    const user = userEvent.setup();

    await act(async () => user.click(buttonWithText(container, "grantRulesTitle")));
    // the back button on a sub-screen is labeled with the role's name
    const backFromGrantRules = buttonWithText(container, "Judges");
    // GrantRulesPanel's own empty state, scoped to this role's rules
    expect(container.textContent).toContain("noGrantRulesYetTitle");

    await act(async () => user.click(backFromGrantRules));
    expect(container.querySelector("h1")?.textContent).toBe("Judges");
    expect(() => buttonWithText(container, "grantRulesTitle")).not.toThrow();
  });

  it("walks list → role → permissions → back → role → members → back → role → back", async () => {
    const user = userEvent.setup();

    // role -> permissions
    await act(async () => user.click(buttonWithText(container, "capabilitiesLabel")));
    expect(container.textContent).toContain("users:read");
    // the back button on a sub-screen is labeled with the role's name
    const backFromCapabilities = buttonWithText(container, "Judges");

    // toggle a capability's tri-state control (in-progress edit, unsaved)
    await act(async () => user.click(buttonWithText(container, "capabilityStateDeny")));
    const saveCapsButton = buttonWithText(container, "saveCapabilities");
    expect(saveCapsButton.disabled).toBe(false);

    // permissions -> role (unsaved edit must survive the round trip)
    await act(async () => user.click(backFromCapabilities));
    expect(container.querySelector("h1")?.textContent).toBe("Judges");

    // role -> permissions again: the toggle should still be dirty/unsaved
    await act(async () => user.click(buttonWithText(container, "capabilitiesLabel")));
    expect(buttonWithText(container, "saveCapabilities").disabled).toBe(false);
    expect(onSaveCapabilities).not.toHaveBeenCalled();

    // permissions -> role -> members
    await act(async () => user.click(buttonWithText(container, "Judges")));
    await act(async () => user.click(buttonWithText(container, "membersTitle")));
    expect(container.textContent).toContain("noMembersYetPeriod");

    // members -> role
    await act(async () => user.click(buttonWithText(container, "Judges")));
    expect(container.querySelector("h1")?.textContent).toBe("Judges");
    expect(() => buttonWithText(container, "capabilitiesLabel")).not.toThrow();

    // role -> list (delegated to the parent via onBack)
    expect(onBack).not.toHaveBeenCalled();
    await act(async () => user.click(buttonWithText(container, "backToRoles")));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("renders the master-detail tabs (not the drill-down) when mobile is not set", () => {
    act(() => root.unmount());
    root = createRoot(container);
    act(() => {
      root.render(
        <RoleEditor
          role={role}
          users={new Map()}
          onSaveDetails={vi.fn().mockResolvedValue(undefined)}
          onSaveCapabilities={vi.fn().mockResolvedValue(undefined)}
          onAddMember={vi.fn().mockResolvedValue(undefined)}
          onRemoveMember={vi.fn().mockResolvedValue(undefined)}
          onDelete={vi.fn().mockResolvedValue(undefined)}
          searchUsers={vi.fn().mockResolvedValue([])}
          loadSeedDiff={vi.fn().mockRejectedValue(new Error("not seeded"))}
          onResetToDefault={vi.fn().mockResolvedValue(undefined)}
        />,
      );
    });

    // The desktop tab strip is present, and there is no nav-row into
    // Permissions/Members — that content is reached via the tabs instead.
    const tablist = container.querySelector('[role="tablist"]');
    expect(tablist).not.toBeNull();
    // Grant Rules is a tab alongside Display/Capabilities/Members (H8),
    // not a separate top-level "Automation" tab.
    expect(tablist?.textContent).toContain("grantRulesTitle");
  });
});
