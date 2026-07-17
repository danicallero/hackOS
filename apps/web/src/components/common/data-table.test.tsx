import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Column, DataTable } from "./data-table";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

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
        tryDifferentSearch: "Try another search or clear the filters.",
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

  it("makes interactive rows focusable and activates them with Enter", () => {
    const onActivate = vi.fn();
    render(
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        onRowClick={onActivate}
        getRowLabel={(row) => `Open ${row.name}`}
      />,
    );

    const row = container.querySelector<HTMLElement>('[role="link"]');
    expect(row?.tabIndex).toBe(0);
    expect(row?.getAttribute("aria-label")).toBe("Open Ada");
    act(() => {
      row?.focus();
      row?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(document.activeElement).toBe(row);
    expect(onActivate).toHaveBeenCalledWith(rows[0]);
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
    const clearFilters = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Clear filters",
    );
    act(() => clearFilters?.click());
    expect(input?.value).toBe("");
    expect(container.textContent).not.toContain("No results");
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

  it("exposes sort direction, pagination, and selection announcements", () => {
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
    expect(container.querySelector('nav[aria-label="Table pagination"]')?.textContent).toContain(
      "Page 1 of 2",
    );
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
});
