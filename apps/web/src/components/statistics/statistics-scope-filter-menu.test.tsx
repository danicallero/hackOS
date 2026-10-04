import {
  STATISTICS_PARTICIPANT_STATUSES,
  type StatisticsParticipantStatus,
} from "@hackos/shared/statistics";
import { findByRole, getByRole, queryByRole } from "@testing-library/dom";
import userEvent from "@testing-library/user-event";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type StatisticsFilterScope,
  StatisticsScopeFilterMenu,
} from "./statistics-scope-filter-menu";

const viewport = vi.hoisted(() => ({ mobile: false }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => viewport.mobile }));
vi.mock("@/lib/i18n", () => ({
  useLocale: () => ({
    t: (key: string, params?: { name?: string }) =>
      ({
        filtersLabel: "Filters",
        applications: "Applications",
        rolesTitle: "Roles",
        back: "Back",
        selectAll: "Select all",
        clearFilters: "Clear filters",
        statisticsParticipantConfirmed: "Confirmed",
        statisticsParticipantAll: "All",
        statisticsAcceptedInternal: "Accepted internally",
        statisticsAcceptedSent: "Sent",
      })[key] ?? `Remove ${params?.name}`,
  }),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const scopes: StatisticsFilterScope[] = [
  { key: "application:1", kind: "application", name: "Participant application" },
  { key: "application:4", kind: "application", name: "Mentor application" },
  { key: "role:2", kind: "role", name: "Organizer" },
  { key: "role:3", kind: "role", name: "Volunteer" },
];

function FilterHarness() {
  const [selected, setSelected] = useState<string[]>(["application:1"]);
  const [statuses, setStatuses] = useState<Record<string, StatisticsParticipantStatus[]>>({
    "application:1": ["confirmed"],
  });
  return (
    <StatisticsScopeFilterMenu
      scopes={scopes}
      selectedScopeKeys={selected}
      participantStatusesByApplication={statuses}
      onScopeChange={setSelected}
      onParticipantStatusesChange={(key, next) =>
        setStatuses((current) => ({ ...current, [key]: next }))
      }
    />
  );
}

describe("StatisticsScopeFilterMenu", () => {
  let container: HTMLDivElement;
  let root: Root;
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    viewport.mobile = false;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    user = userEvent.setup();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("selects multiple participant statuses within an application submenu", async () => {
    expect(STATISTICS_PARTICIPANT_STATUSES).toEqual(["accepted_internal", "accepted", "confirmed"]);
    act(() => root.render(<FilterHarness />));
    const trigger = getByRole(document.body, "button", { name: "Filters 1" });
    act(() => trigger.focus());
    await act(async () => user.keyboard("{Enter}{ArrowLeft}"));
    const selectAllApplications = await findByRole(document.body, "menuitemcheckbox", {
      name: "Select all",
    });
    expect(selectAllApplications.getAttribute("aria-checked")).toBe("false");
    const applicationItem = await findByRole(document.body, "menuitem", {
      name: "Participant application",
    });
    act(() => applicationItem.focus());
    await act(async () => user.keyboard("{ArrowLeft}"));
    const allOption = getByRole(document.body, "menuitemradio", { name: "All" });
    await act(async () => user.click(allOption));
    expect(allOption.getAttribute("aria-checked")).toBe("true");
    await act(async () => user.click(getByRole(document.body, "menuitemradio", { name: "All" })));
    expect(
      getByRole(document.body, "menuitemradio", { name: "All" }).getAttribute("aria-checked"),
    ).toBe("true");
    await act(async () =>
      user.click(getByRole(document.body, "menuitemcheckbox", { name: "Accepted internally" })),
    );
    await act(async () =>
      user.click(getByRole(document.body, "menuitemcheckbox", { name: "Sent" })),
    );
    await act(async () =>
      user.click(getByRole(document.body, "menuitemcheckbox", { name: "Confirmed" })),
    );
    await act(async () => user.keyboard("{Escape}{Escape}{Escape}"));

    expect(
      getByRole(document.body, "button", {
        name: "Remove Participant application: Accepted internally, Sent, Confirmed",
      }),
    ).toBeDefined();
  });

  it("selects all roles as a group and removes only that group", async () => {
    act(() => root.render(<FilterHarness />));
    const trigger = getByRole(document.body, "button", { name: "Filters 1" });
    act(() => trigger.focus());
    await act(async () => user.keyboard("{Enter}"));
    const rolesItem = getByRole(document.body, "menuitem", { name: "Roles 0/2" });
    act(() => rolesItem.focus());
    await act(async () => user.keyboard("{ArrowLeft}"));
    await act(async () =>
      user.click(getByRole(document.body, "menuitemcheckbox", { name: "Select all" })),
    );
    await act(async () => user.keyboard("{Escape}{Escape}"));

    expect(getByRole(document.body, "button", { name: "Filters 3" })).toBeDefined();
    act(() => trigger.focus());
    await act(async () => user.keyboard("{Enter}"));
    const rolesItemAfterSelect = getByRole(document.body, "menuitem", { name: "Roles 2/2" });
    act(() => rolesItemAfterSelect.focus());
    await act(async () => user.keyboard("{ArrowLeft}"));
    await act(async () =>
      user.click(getByRole(document.body, "menuitemcheckbox", { name: "Select all" })),
    );
    await act(async () => user.keyboard("{Escape}{Escape}"));
    expect(getByRole(document.body, "button", { name: "Filters 1" })).toBeDefined();
  });

  it("uses a mobile back stack to select all response statuses", async () => {
    viewport.mobile = true;
    act(() => root.render(<FilterHarness />));
    await act(async () => user.click(getByRole(document.body, "button", { name: "Filters 1" })));
    await act(async () =>
      user.click(getByRole(document.body, "menuitem", { name: /Applications\s*1/ })),
    );
    await act(async () =>
      user.click(getByRole(document.body, "menuitem", { name: /Participant application/ })),
    );
    expect(document.activeElement).toBe(getByRole(document.body, "menuitem", { name: "Back" }));
    await act(async () => user.click(getByRole(document.body, "menuitemradio", { name: "All" })));
    await act(async () => user.keyboard("{Escape}"));
    expect(
      getByRole(document.body, "button", {
        name: "Remove Participant application: All",
      }),
    ).toBeDefined();
    expect(queryByRole(document.body, "menuitemcheckbox", { name: "Confirmed" })).toBeDefined();
  });
});
