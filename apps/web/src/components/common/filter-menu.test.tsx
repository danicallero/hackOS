import { UsersIcon } from "@phosphor-icons/react/dist/csr/Users";
import { getByRole, queryByRole } from "@testing-library/dom";
import userEvent from "@testing-library/user-event";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FilterMenu } from "./filter-menu";

const viewport = vi.hoisted(() => ({ mobile: false }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => viewport.mobile }));
vi.mock("@/lib/i18n", () => ({
  useLocale: () => ({
    t: (key: string, params?: { name: string }) =>
      ({ filtersLabel: "Filters", back: "Back", clearFilters: "Clear filters" })[key] ??
      `Remove ${params?.name}`,
  }),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function FilteredList({ initiallyFiltered = false }: { initiallyFiltered?: boolean }) {
  const [status, setStatus] = useState(initiallyFiltered ? "confirmed" : "all");
  const [audiences, setAudiences] = useState<string[]>(
    initiallyFiltered ? ["staff", "judges"] : [],
  );
  return (
    <FilterMenu
      filters={[
        {
          id: "status",
          label: "Status",
          icon: UsersIcon,
          type: "single",
          value: status,
          resetValue: "all",
          onChange: setStatus,
          options: [
            { value: "all", label: "Any status" },
            { value: "confirmed", label: "Confirmed" },
          ],
        },
        {
          id: "audience",
          label: "Audience",
          icon: UsersIcon,
          type: "multiple",
          value: audiences,
          onChange: setAudiences,
          options: [
            { value: "staff", label: "Staff" },
            { value: "judges", label: "Judges" },
          ],
        },
      ]}
    />
  );
}

describe("FilterMenu", () => {
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

  it("opens a desktop submenu by keyboard and displays the chosen filter", async () => {
    act(() => root.render(<FilteredList />));
    const trigger = getByRole(document.body, "button", { name: "Filters" });
    act(() => trigger.focus());
    await act(async () => user.keyboard("{Enter}{ArrowRight}"));
    expect(getByRole(document.body, "menuitemradio", { name: "Any status" })).toBeDefined();
    await act(async () => user.keyboard("{ArrowDown}{Enter}"));
    expect(getByRole(document.body, "button", { name: "Remove Status: Confirmed" })).toBeDefined();
    expect(queryByRole(document.body, "menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("removes only the selected chip and returns focus to the filter trigger", async () => {
    act(() => root.render(<FilteredList initiallyFiltered />));
    await act(async () =>
      user.click(getByRole(document.body, "button", { name: "Remove Audience: Staff" })),
    );
    expect(queryByRole(document.body, "button", { name: "Remove Audience: Staff" })).toBeNull();
    expect(getByRole(document.body, "button", { name: "Remove Audience: Judges" })).toBeDefined();
    expect(getByRole(document.body, "button", { name: "Remove Status: Confirmed" })).toBeDefined();
    expect(document.activeElement).toBe(getByRole(document.body, "button", { name: "Filters 2" }));
  });

  it("clears all categories together, including single and multiple selections", async () => {
    act(() => root.render(<FilteredList initiallyFiltered />));
    await act(async () => user.click(getByRole(document.body, "button", { name: "Filters 3" })));
    await act(async () =>
      user.click(getByRole(document.body, "menuitem", { name: "Clear filters" })),
    );
    expect(container.querySelectorAll('button[aria-label^="Remove"]')).toHaveLength(0);
    expect(getByRole(document.body, "button", { name: "Filters" })).toBeDefined();
  });

  it("keeps mobile multiple choices open and provides a focused route back to categories", async () => {
    viewport.mobile = true;
    act(() => root.render(<FilteredList />));
    await act(async () => user.click(getByRole(document.body, "button", { name: "Filters" })));
    await act(async () => user.click(getByRole(document.body, "menuitem", { name: "Audience" })));
    expect(document.activeElement).toBe(getByRole(document.body, "menuitem", { name: "Back" }));
    await act(async () =>
      user.click(getByRole(document.body, "menuitemcheckbox", { name: "Staff" })),
    );
    await act(async () =>
      user.click(getByRole(document.body, "menuitemcheckbox", { name: "Judges" })),
    );
    expect(
      getByRole(document.body, "menuitemcheckbox", { name: "Staff" }).getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      getByRole(document.body, "menuitemcheckbox", { name: "Judges" }).getAttribute("aria-checked"),
    ).toBe("true");
    await act(async () => user.click(getByRole(document.body, "menuitem", { name: "Back" })));
    expect(queryByRole(document.body, "menuitemcheckbox")).toBeNull();
    expect(document.activeElement).toBe(getByRole(document.body, "menuitem", { name: "Status" }));
    await act(async () => user.keyboard("{Escape}"));
    expect(getByRole(document.body, "button", { name: "Remove Audience: Staff" })).toBeDefined();
    expect(getByRole(document.body, "button", { name: "Remove Audience: Judges" })).toBeDefined();
  });
});
