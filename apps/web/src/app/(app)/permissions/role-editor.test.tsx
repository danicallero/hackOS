import userEvent from "@testing-library/user-event";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import type { PermissionState, RoleSummary, UserListItem } from "@/lib/types";
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
          onRemoveMembers={vi.fn().mockResolvedValue(undefined)}
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
          onRemoveMembers={vi.fn().mockResolvedValue(undefined)}
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

describe("RoleEditor members panel", () => {
  let container: HTMLDivElement;
  let root: Root;
  let onRemoveMember: (userId: number) => Promise<void>;
  let onRemoveMembers: (userIds: number[]) => Promise<void>;

  const roleWithMembers: RoleSummary = { ...role, memberIds: [10, 20, 30] };
  const users = new Map<number, UserListItem>([
    [10, makeUser(10, "Ada")],
    [20, makeUser(20, "Bea")],
    [30, makeUser(30, "Cid")],
  ]);

  function makeUser(id: number, name: string): UserListItem {
    return {
      id,
      email: `${name.toLowerCase()}@example.com`,
      emailVerified: true,
      name,
      surname: null,
      badgeId: null,
      visibleRoleName: null,
      language: "en",
      shirtSize: null,
      applicationStatus: null,
      confirmedSpot: false,
      isTestAccount: false,
      createdAt: "2026-01-01T00:00:00Z",
    };
  }

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    onRemoveMember = vi.fn().mockResolvedValue(undefined);
    // Mirrors page.tsx's real onRemoveMembers: parallel per-user DELETEs.
    onRemoveMembers = vi.fn(async (userIds: number[]) => {
      await Promise.all(
        userIds.map((userId) => api.delete(`/api/roles/${roleWithMembers.id}/users/${userId}`)),
      );
    });

    act(() => {
      root.render(
        <RoleEditor
          role={roleWithMembers}
          users={users}
          onSaveDetails={vi.fn().mockResolvedValue(undefined)}
          onSaveCapabilities={vi.fn().mockResolvedValue(undefined)}
          onAddMember={vi.fn().mockResolvedValue(undefined)}
          onRemoveMember={onRemoveMember}
          onRemoveMembers={onRemoveMembers}
          onDelete={vi.fn().mockResolvedValue(undefined)}
          searchUsers={vi.fn().mockResolvedValue([])}
          loadSeedDiff={vi.fn().mockRejectedValue(new Error("not seeded"))}
          onResetToDefault={vi.fn().mockResolvedValue(undefined)}
        />,
      );
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.mocked(api.delete).mockClear();
  });

  function goToMembersTab(user: ReturnType<typeof userEvent.setup>) {
    return act(async () => user.click(buttonWithText(container, "membersTitle")));
  }

  it("renders each member's name as a link to their profile", async () => {
    const user = userEvent.setup();
    await goToMembersTab(user);

    const link = [...container.querySelectorAll("a")].find((a) => a.textContent === "Ada");
    expect(link).toBeDefined();
    expect(link?.getAttribute("href")).toBe("/users/10");
  });

  it("selects 2 of 3 members and bulk-removes them, leaving the third", async () => {
    const user = userEvent.setup();
    await goToMembersTab(user);

    const checkboxes = [...container.querySelectorAll('[role="checkbox"]')];
    // First checkbox is "select all"; the next three are Ada, Bea, Cid in order.
    await act(async () => user.click(checkboxes[1]));
    await act(async () => user.click(checkboxes[2]));

    await act(async () => user.click(buttonWithText(container, "removeRoleFromMembersOther")));

    expect(onRemoveMembers).toHaveBeenCalledTimes(1);
    expect(onRemoveMembers).toHaveBeenCalledWith([10, 20]);
    expect(api.delete).toHaveBeenCalledWith("/api/roles/1/users/10");
    expect(api.delete).toHaveBeenCalledWith("/api/roles/1/users/20");
    expect(api.delete).not.toHaveBeenCalledWith("/api/roles/1/users/30");

    // Cid's row is untouched — role.memberIds itself only changes once the
    // parent re-syncs (applyRole), which this fixture doesn't simulate.
    expect(container.textContent).toContain("Cid");
  });
});
