import userEvent from "@testing-library/user-event";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Column, DataTable } from "./data-table";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// DataTable calls useRouter() to navigate on a row click. jsdom mounts no App
// Router, so without this every render throws "invariant expected app router to
// be mounted" before any assertion runs. Exposing push as a spy also makes the
// row-click navigation path assertable instead of merely unblocked.
const routerPush = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: routerPush,
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock("@/lib/i18n", () => ({
  useLocale: () => ({
    t: (key: string, values: Record<string, string | number> = {}) => {
      const copy: Record<string, string> = {
        searchTable: "Search table",
        clearSearch: "Clear search",
        filterPlaceholder: "Filter…",
        tableResultCount: "{count} results",
        sortBy: "Sort by {column}",
        noFilteredResults: "No results",
        clearFilters: "Clear filters",
        nothingToShow: "Nothing to show",
        tablePagination: "Table pagination",
        paginationSummary: "{start}–{end} of {total}. Page {page} of {pages}.",
        previous: "Previous",
        next: "Next",
        selectionCount: "{count} rows selected",
        selectAll: "Select all",
        selectRow: "Select row",
        retry: "Retry",
        openRow: "Open row",
      };
      return Object.entries(values).reduce(
        (text, [name, value]) => text.replace(`{${name}}`, String(value)),
        copy[key] ?? key,
      );
    },
  }),
}));

interface Row {
  id: string;
  name: string;
}

const columns: Column<Row>[] = [
  {
    id: "name",
    header: "Name",
    cell: (row) => row.name,
    sortValue: (row) => row.name,
  },
];

const rows: Row[] = [
  { id: "1", name: "Ada" },
  { id: "2", name: "Grace" },
];

describe("DataTable accessibility and interactions", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    routerPush.mockClear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(table: React.ReactNode) {
    act(() => root.render(table));
  }

  it("keeps rows semantic and activates the native link with Enter", async () => {
    render(
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        getRowHref={(row) => `/people/${row.id}`}
        getRowLabel={(row) => `Open ${row.name}`}
      />,
    );

    const link = container.querySelector<HTMLAnchorElement>('a[aria-label="Open Ada"]');
    const row = link?.closest("tr");
    expect(link?.getAttribute("href")).toBe("/people/1");
    expect(link?.getAttribute("data-size")).toBe("icon-lg");
    expect(link?.classList.contains("md:size-[var(--control-height-compact)]")).toBe(true);
    expect(row?.getAttribute("role")).toBeNull();
    expect(row?.getAttribute("tabindex")).toBeNull();
    act(() => {
      link?.focus();
    });
    expect(document.activeElement).toBe(link);
    const activated = vi.fn();
    link?.addEventListener("click", (event) => {
      event.preventDefault();
      activated();
    });
    await act(async () => {
      await userEvent.keyboard("{Enter}");
    });
    expect(activated).toHaveBeenCalledOnce();
  });

  it("navigates via the router when a row with an href is clicked", async () => {
    const onRowClick = vi.fn();
    render(
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        getRowHref={(row) => `/people/${row.id}`}
        getRowLabel={(row) => `Open ${row.name}`}
        onRowClick={onRowClick}
      />,
    );

    const cell = container.querySelectorAll("tbody tr")[1]?.querySelector("td");
    await act(async () => {
      await userEvent.click(cell as Element);
    });
    // getRowHref wins over onRowClick when both are supplied.
    expect(routerPush).toHaveBeenCalledExactlyOnceWith("/people/2");
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("renders an accessible mobile drill-down row when configured", () => {
    render(
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        getRowHref={(row) => `/people/${row.id}`}
        renderMobileRow={(row) => (
          <a href={`/people/${row.id}`} aria-label={`Open ${row.name}`}>
            {row.name}
          </a>
        )}
      />,
    );

    expect(container.querySelector("ul")?.textContent).toContain("Ada");
    expect(container.querySelector('ul a[href="/people/1"]')?.getAttribute("aria-label")).toBe(
      "Open Ada",
    );
    expect(container.querySelector("table")).not.toBeNull();
  });

  it("falls back to onRowClick when the row has no href", async () => {
    const onRowClick = vi.fn();
    render(
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        onRowClick={onRowClick}
      />,
    );

    const cell = container.querySelector("tbody tr td");
    await act(async () => {
      await userEvent.click(cell as Element);
    });
    expect(onRowClick).toHaveBeenCalledExactlyOnceWith(rows[0]);
    expect(routerPush).not.toHaveBeenCalled();
  });

  it("uses a native Space-activated button and isolates nested controls", async () => {
    const activate = vi.fn();
    const nested = vi.fn();
    const select = vi.fn();
    render(
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        onRowClick={activate}
        getRowLabel={(row) => `Review ${row.name}`}
        selectable
        selectedIds={new Set()}
        onSelectionChange={select}
        rowActions={() => (
          <button type="button" onClick={nested}>
            More
          </button>
        )}
      />,
    );

    const action = container.querySelector<HTMLButtonElement>('button[aria-label="Review Ada"]');
    expect(action?.tagName).toBe("BUTTON");
    expect(action?.type).toBe("button");
    expect(action?.getAttribute("data-size")).toBe("icon-lg");
    expect(action?.classList.contains("md:size-[var(--control-height-compact)]")).toBe(true);
    const nestedButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "More",
    );
    act(() => nestedButton?.click());
    expect(nested).toHaveBeenCalledOnce();
    expect(activate).not.toHaveBeenCalled();
    const checkboxes = container.querySelectorAll('[role="checkbox"]');
    act(() => (checkboxes[1] as HTMLElement | undefined)?.click());
    expect(select).toHaveBeenCalledOnce();
    expect(activate).not.toHaveBeenCalled();
    action?.focus();
    await act(async () => {
      await userEvent.keyboard(" ");
    });
    expect(activate).toHaveBeenCalledWith(rows[0]);
  });

  it("labels search, reports results, clears search, and distinguishes filtered zero", () => {
    render(
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        searchable={(row) => row.name}
        searchLabel="Search people"
        empty={{ title: "No people yet" }}
      />,
    );

    const input = container.querySelector<HTMLInputElement>('input[type="search"]');
    expect(input?.labels?.[0]?.textContent).toBe("Search people");
    act(() => {
      if (!input) return;
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      valueSetter?.call(input, "missing");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.textContent).toContain("0 results");
    expect(container.textContent).toContain("No results");
    expect(container.querySelector('button[aria-label="Clear search"]')).not.toBeNull();
    const clearSearch = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Clear search"]',
    );
    act(() => clearSearch?.click());
    expect(input?.value).toBe("");
    expect(document.activeElement).toBe(input);

    act(() => {
      if (!input) return;
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      valueSetter?.call(input, "missing");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const clearFilters = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Clear filters",
    );
    act(() => clearFilters?.click());
    expect(input?.value).toBe("");
    expect(container.textContent).not.toContain("No results");
  });

  it("supports externally filtered zero states and their clear action", () => {
    const clear = vi.fn();
    render(
      <DataTable
        columns={columns}
        data={[]}
        getRowId={(row) => row.id}
        empty={{ title: "No people yet" }}
        filteredEmpty={{ active: true, onClear: clear }}
      />,
    );

    expect(container.textContent).toContain("No results");
    expect(container.textContent).not.toContain("No people yet");
    const clearButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Clear filters",
    );
    act(() => clearButton?.click());
    expect(clear).toHaveBeenCalledOnce();
  });

  it("keeps dataset-empty actions distinct from filtered-zero recovery", () => {
    const create = vi.fn();
    render(
      <DataTable
        columns={columns}
        data={[]}
        getRowId={(row) => row.id}
        searchable={(row) => row.name}
        empty={{
          title: "No people yet",
          action: (
            <button type="button" onClick={create}>
              Create person
            </button>
          ),
        }}
      />,
    );

    expect(container.textContent).toContain("No people yet");
    expect(container.textContent).not.toContain("No results");
    const createButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Create person",
    );
    act(() => createButton?.click());
    expect(create).toHaveBeenCalledOnce();
  });

  it("updates sort direction and pagination announcements with the visible page", () => {
    render(
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        pageSize={1}
        selectable
        selectedIds={new Set(["1"])}
        onSelectionChange={() => undefined}
      />,
    );

    const header = container.querySelector('th[aria-sort="none"]');
    const sort = container.querySelector<HTMLButtonElement>('button[aria-label="Sort by Name"]');
    expect(header?.getAttribute("aria-sort")).toBe("none");
    act(() => sort?.click());
    expect(header?.getAttribute("aria-sort")).toBe("ascending");
    act(() => sort?.click());
    expect(header?.getAttribute("aria-sort")).toBe("descending");
    act(() => sort?.click());
    expect(header?.getAttribute("aria-sort")).toBe("none");
    expect(container.querySelector('nav[aria-label="Table pagination"]')?.textContent).toContain(
      "Page 1 of 2",
    );
    const next = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Next",
    );
    act(() => next?.click());
    expect(container.textContent).toContain("Page 2 of 2");
    expect(container.textContent).toContain("Grace");
    expect(container.textContent).not.toContain("Ada");
  });

  it("announces live selection changes", () => {
    function SelectableTable() {
      const [selected, setSelected] = useState<Set<string>>(new Set());
      return (
        <DataTable
          columns={columns}
          data={rows}
          getRowId={(row) => row.id}
          selectable
          selectedIds={selected}
          onSelectionChange={setSelected}
        />
      );
    }

    render(<SelectableTable />);
    expect(container.textContent).toContain("0 rows selected");
    const rowCheckboxes = container.querySelectorAll('[role="checkbox"]');
    act(() => (rowCheckboxes[1] as HTMLElement | undefined)?.click());
    expect(container.textContent).toContain("1 rows selected");
  });

  it("keeps errors visible and offers a retry action", () => {
    const retry = vi.fn();
    render(
      <DataTable
        columns={columns}
        data={[]}
        getRowId={(row) => row.id}
        error={{ message: "Could not load people", onRetry: retry }}
      />,
    );

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Could not load people",
    );
    const retryButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Retry",
    );
    act(() => retryButton?.click());
    expect(retry).toHaveBeenCalledOnce();
  });

  it("keeps rows available beside persistent mutation errors and safely retries", () => {
    const retry = vi.fn();
    render(
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        mutationError={{ message: "Could not update selected rows", onRetry: retry }}
      />,
    );

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Could not update selected rows",
    );
    expect(container.textContent).toContain("Ada");
    expect(container.textContent).toContain("Grace");
    const retryButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Retry",
    );
    act(() => retryButton?.click());
    expect(retry).toHaveBeenCalledOnce();
  });
});
