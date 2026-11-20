"use client";

import { ArrowDownIcon } from "@phosphor-icons/react/dist/csr/ArrowDown";
import { ArrowsDownUpIcon } from "@phosphor-icons/react/dist/csr/ArrowsDownUp";
import { ArrowUpIcon } from "@phosphor-icons/react/dist/csr/ArrowUp";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ActionGroup } from "@/components/common/action-group";
import { ContextualError } from "@/components/common/contextual-error";
import { EmptyState } from "@/components/common/empty-state";
import { IconButton } from "@/components/common/icon-button";
import { PageToolbar } from "@/components/common/page-toolbar";
import { SearchField } from "@/components/common/search-field";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { usePersistedState } from "@/hooks/use-persisted-state";
import { useScrollRestoration } from "@/hooks/use-scroll-restoration";
import { useLocale } from "@/lib/i18n";
import { normalizeSearchText } from "@/lib/search-text";
import { cn } from "@/lib/utils";

const DEFAULT_SORT = "__default";

export interface SortKey {
  id: string;
  dir: "asc" | "desc";
}

/**
 * Next sort after activating a column header. A plain click sorts by that
 * column alone (asc → desc → off); Shift+click adds it as a further key, or
 * cycles/removes it while keeping the other keys, so "best grade first, then
 * earliest published" is two keys applied in order.
 */
export function nextSort(sort: readonly SortKey[], id: string, additive: boolean): SortKey[] {
  const existing = sort.find((key) => key.id === id);
  if (!additive) {
    if (sort.length !== 1 || !existing) return [{ id, dir: "asc" }];
    return existing.dir === "asc" ? [{ id, dir: "desc" }] : [];
  }
  if (!existing) return [...sort, { id, dir: "asc" }];
  return existing.dir === "asc"
    ? sort.map((key) => (key.id === id ? { id, dir: "desc" } : key))
    : sort.filter((key) => key.id !== id);
}

/** Orders rows by each key in turn; ties on every key keep their incoming order. */
export function sortRows<T>(
  rows: readonly T[],
  sort: readonly SortKey[],
  columns: readonly Pick<Column<T>, "id" | "sortValue">[],
): T[] {
  const keys = sort.flatMap((key) => {
    const value = columns.find((col) => col.id === key.id)?.sortValue;
    return value ? [{ value, dir: key.dir === "asc" ? 1 : -1 }] : [];
  });
  if (keys.length === 0) return [...rows];
  return [...rows].sort((a, b) => {
    for (const { value, dir } of keys) {
      const av = value(a) ?? "";
      const bv = value(b) ?? "";
      if (av < bv) return -dir;
      if (av > bv) return dir;
    }
    return 0;
  });
}

export interface Column<T> {
  id: string;
  header: React.ReactNode;
  /** Cell renderer. */
  cell: (row: T) => React.ReactNode;
  /** Return a comparable value to make the column sortable. */
  sortValue?: (row: T) => string | number;
  align?: "left" | "right" | "center";
  className?: string;
  headerClassName?: string;
  /** e.g. "w-40". Any column with a width switches the table to fixed layout so widths stay put across pages and sorts; columns without one share the rest. */
  width?: string;
  /** Accessible column name when the visual header is not plain text. */
  sortLabel?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  getRowId: (row: T) => string;
  /** Trailing actions cell (e.g. a "…" dropdown). */
  rowActions?: (row: T) => React.ReactNode;
  /** Native button action rendered in its own table cell. */
  onRowClick?: (row: T) => void;
  /** Native link destination rendered in its own table cell; null leaves that row inert. */
  getRowHref?: (row: T) => string | null;
  /** Accessible name for the row link or button. */
  getRowLabel?: (row: T) => string;
  /** Render a drill-down row for narrow screens instead of the table. */
  renderMobileRow?: (row: T) => React.ReactNode;
  /** Provide searchable text per row to show a filter box. */
  searchable?: (row: T) => string;
  searchPlaceholder?: string;
  searchLabel?: string;
  /** Extra toolbar content, right-aligned (e.g. a Columns toggle, a button). */
  toolbar?: React.ReactNode;
  /** Enable client-side pagination at this page size. */
  pageSize?: number;
  pageSizeOptions?: readonly number[];
  loading?: boolean;
  empty?: { title: string; description?: string; action?: React.ReactNode };
  filteredEmpty?: {
    active: boolean;
    onClear: () => void;
    title?: string;
  };
  error?: { message: string; onRetry?: () => void };
  /** Persistent mutation feedback that leaves the current rows available. */
  mutationError?: { message: string; onRetry?: () => void };
  className?: string;
  /** Extra classes for the table itself, e.g. a min width so a fixed layout scrolls instead of squeezing flexible columns. */
  tableClassName?: string;
  /** Enable row selection via checkboxes. */
  selectable?: boolean;
  selectedIds?: Set<string>;
  onSelectionChange?: (ids: Set<string>) => void;
  /**
   * Opt in to this table's search/sort/page and window scroll position
   * surviving a trip to a detail page and back in browser history.
   * Must be unique per table instance on the page (e.g. "audit-list").
   */
  stateKey?: string;
  /** Fires with the current search/sort-applied (but not yet paginated) row
   *  order — lets a caller page through rows in the order actually on
   *  screen, e.g. prev/next inside a detail modal. */
  onVisibleRowsChange?: (rows: T[]) => void;
  /** Replaces the row element, e.g. with a sortable row; it must render `key={getRowId(row)}`. */
  renderRow?: (
    row: T,
    props: { className?: string; onClick?: () => void },
    cells: React.ReactNode,
  ) => React.ReactNode;
}

/** Room an unsized column keeps in a fixed layout, in rem. */
const FLEXIBLE_COLUMN_MIN_REM = 14;

/**
 * A fixed layout hands unsized columns only the leftover width, which reaches
 * zero in a narrow container and lets their content run under the next
 * column. Flooring the table makes it scroll instead.
 */
function fixedLayoutMinWidth(
  columns: readonly { width?: string }[],
  selectable: boolean,
): string | undefined {
  if (!columns.some((col) => col.width)) return undefined;
  let rem = selectable ? 2.5 : 0;
  for (const col of columns) {
    const spacing = col.width?.match(/(?:^|\s)w-(\d+(?:\.\d+)?)(?:\s|$)/);
    rem += spacing ? Number(spacing[1]) / 4 : FLEXIBLE_COLUMN_MIN_REM;
  }
  return `${rem}rem`;
}

const alignClass = { left: "text-left", right: "text-right", center: "text-center" } as const;

function DataTableCell({ children, className }: { children: React.ReactNode; className?: string }) {
  const descriptionId = useId();
  const cellRef = useRef<HTMLTableCellElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  const [open, setOpen] = useState(false);
  const [fullValue, setFullValue] = useState("");

  useLayoutEffect(() => {
    const cell = cellRef.current;
    if (!cell) return;
    const measure = () => {
      const hasOverflow = (element: HTMLElement) =>
        element.scrollWidth > element.clientWidth + 1 ||
        element.scrollHeight > element.clientHeight + 1;
      const truncated =
        hasOverflow(cell) ||
        Array.from(cell.querySelectorAll<HTMLElement>("*")).some(
          (element) => Boolean(element.textContent?.trim()) && hasOverflow(element),
        );
      setOverflowing(truncated);
      if (truncated) {
        setFullValue(cell.textContent?.trim() ?? "");
      }
    };
    measure();
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    const observeContent = () => {
      resizeObserver?.observe(cell);
      for (const element of cell.querySelectorAll<HTMLElement>("*")) {
        resizeObserver?.observe(element);
      }
    };
    observeContent();
    const mutationObserver = new MutationObserver(() => {
      observeContent();
      measure();
    });
    mutationObserver.observe(cell, {
      attributes: true,
      attributeFilter: ["style", "class"],
      childList: true,
      characterData: true,
      subtree: true,
    });
    return () => {
      resizeObserver?.disconnect();
      mutationObserver.disconnect();
    };
  }, []);

  const cell = (
    <TableCell
      ref={cellRef}
      tabIndex={overflowing ? 0 : undefined}
      aria-describedby={overflowing ? descriptionId : undefined}
      className={cn(
        className,
        overflowing && "focus-visible:inset-ring-2 focus-visible:inset-ring-ring",
      )}
      onFocus={overflowing ? () => setOpen(true) : undefined}
      onClick={
        overflowing
          ? (event) => {
              event.stopPropagation();
              setOpen(true);
            }
          : undefined
      }
      onBlur={
        overflowing
          ? (event) => {
              const content = document.querySelector('[data-slot="popover-content"]');
              if (!content?.contains(event.relatedTarget as Node | null)) setOpen(false);
            }
          : undefined
      }
    >
      {children}
    </TableCell>
  );

  if (!overflowing) return cell;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>{cell}</PopoverAnchor>
      <PopoverContent
        id={descriptionId}
        role="tooltip"
        align="start"
        className="max-h-60 max-w-[min(24rem,calc(100vw-2rem))] overflow-auto whitespace-normal break-words p-3 text-sm"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        {fullValue}
      </PopoverContent>
    </Popover>
  );
}

/**
 * One table for the whole app. Columns are described declaratively (header +
 * cell renderer + optional sortValue), and search, sorting, pagination, row
 * actions, loading and empty states are all built in and prop-driven — so
 * every list (containers, users, applications, queue…) looks and behaves the
 * same. It never assumes a data shape: `cell`/`sortValue`/`searchable` are
 * callbacks over your row type. Routes can provide `renderMobileRow` for a
 * narrow-screen drill-down list while keeping the sortable table on wider
 * screens.
 */
export function DataTable<T>({
  columns,
  data,
  getRowId,
  rowActions,
  onRowClick,
  getRowHref,
  getRowLabel,
  renderMobileRow,
  searchable,
  searchPlaceholder,
  searchLabel,
  toolbar,
  pageSize: initialPageSize,
  pageSizeOptions,
  loading,
  empty,
  filteredEmpty,
  error,
  mutationError,
  className,
  tableClassName,
  selectable,
  selectedIds,
  onSelectionChange,
  stateKey,
  onVisibleRowsChange,
  renderRow,
}: DataTableProps<T>) {
  const { t } = useLocale();
  const [query, setQuery] = usePersistedState(stateKey ? `${stateKey}:query` : null, "");
  const [storedSort, setSort] = usePersistedState<SortKey[]>(
    stateKey ? `${stateKey}:sorts` : null,
    [],
  );
  const [preferredPageSize, setPreferredPageSize] = usePersistedState(
    stateKey ? `${stateKey}:pageSize` : null,
    initialPageSize ?? 50,
  );
  const pageSize = pageSizeOptions?.includes(preferredPageSize)
    ? preferredPageSize
    : initialPageSize;
  const pageSizeId = useId();
  const [page, setPage] = usePersistedState(stateKey ? `${stateKey}:page` : null, 0);
  useScrollRestoration(stateKey ? `${stateKey}:scroll` : null, !loading);
  const searchId = useId();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const restoreSearchFocus = useRef(false);

  useEffect(() => {
    if (!query && restoreSearchFocus.current) {
      restoreSearchFocus.current = false;
      searchInputRef.current?.focus();
    }
  }, [query]);

  const filtered = useMemo(() => {
    if (!searchable || !query.trim()) return data;
    const q = normalizeSearchText(query);
    return data.filter((row) => normalizeSearchText(searchable(row)).includes(q));
  }, [data, searchable, query]);

  // Keys for columns that are hidden or no longer sortable drop out.
  const sort = useMemo(
    () =>
      (Array.isArray(storedSort) ? storedSort : []).filter((key) =>
        columns.some((col) => col.id === key.id && col.sortValue),
      ),
    [storedSort, columns],
  );

  const sorted = useMemo(
    () => (sort.length ? sortRows(filtered, sort, columns) : filtered),
    [filtered, sort, columns],
  );

  const reportedRows = useRef<T[] | null>(null);
  // Inline column definitions can recompute the same sorted sequence after a
  // parent stores it (H13). Report only changed rows/order to avoid a render loop.
  useEffect(() => {
    const previous = reportedRows.current;
    if (
      previous &&
      previous.length === sorted.length &&
      previous.every((row, index) => row === sorted[index])
    )
      return;
    reportedRows.current = sorted;
    onVisibleRowsChange?.(sorted);
  }, [sorted, onVisibleRowsChange]);

  const pageCount = pageSize ? Math.max(1, Math.ceil(sorted.length / pageSize)) : 1;
  const current = Math.min(page, pageCount - 1);
  const rows = pageSize ? sorted.slice(current * pageSize, current * pageSize + pageSize) : sorted;

  const sortableColumns = columns.filter((col) => col.sortValue);
  const mobileSort = sort[0] ?? null;
  const columnName = (col: Column<T>) =>
    col.sortLabel ?? (typeof col.header === "string" ? col.header : col.id);

  const toggleSort = (id: string, additive: boolean) => {
    setSort(nextSort(sort, id, additive));
    setPage(0);
  };

  const router = useRouter();
  const showToolbar = Boolean(searchable || toolbar);
  const checkboxCol = selectable ? 1 : 0;
  const rowInteractionCol = onRowClick || getRowHref ? 1 : 0;
  const colCount = columns.length + checkboxCol + rowInteractionCol + (rowActions ? 1 : 0);

  const allSelected =
    selectable && selectedIds && data.length > 0 && data.every((r) => selectedIds.has(getRowId(r)));

  const toggleAll = () => {
    if (!onSelectionChange || !selectedIds) return;
    if (allSelected) {
      onSelectionChange(new Set());
    } else {
      onSelectionChange(new Set(data.map((r) => getRowId(r))));
    }
  };

  const toggleOne = (id: string) => {
    if (!onSelectionChange || !selectedIds) return;
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange(next);
  };

  const clearSearch = () => {
    restoreSearchFocus.current = true;
    setQuery("");
    setPage(0);
  };

  const selectedCount = selectedIds?.size ?? 0;
  const isEmpty = !error && !loading && rows.length === 0;

  function renderEmptyState() {
    return query.trim() || filteredEmpty?.active ? (
      <EmptyState
        title={filteredEmpty?.title ?? t("noFilteredResults")}
        action={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={filteredEmpty?.active ? filteredEmpty.onClear : clearSearch}
          >
            {t("clearFilters")}
          </Button>
        }
      />
    ) : (
      <EmptyState
        title={empty?.title ?? t("nothingToShow")}
        description={empty?.description}
        action={empty?.action}
      />
    );
  }

  return (
    <div className={cn("min-w-0 space-y-4", className)}>
      {showToolbar && (
        <PageToolbar label={t("pageDataControls")}>
          {searchable && (
            <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-2">
              <SearchField
                inputRef={searchInputRef}
                id={searchId}
                label={searchLabel ?? t("searchTable")}
                placeholder={searchPlaceholder ?? t("filterPlaceholder")}
                value={query}
                onValueChange={(value) => {
                  setQuery(value);
                  setPage(0);
                }}
                className="flex-1"
              />
              <span
                role="status"
                aria-live="polite"
                className="text-muted-foreground text-xs tabular-nums"
              >
                {t("tableResultCount", { count: filtered.length })}
              </span>
            </div>
          )}
          {toolbar && <ActionGroup className="ml-auto">{toolbar}</ActionGroup>}
        </PageToolbar>
      )}
      <Card className="@container gap-0 overflow-hidden py-0">
        {mutationError && (
          <ContextualError
            message={mutationError.message}
            onRetry={mutationError.onRetry}
            className="m-4"
          />
        )}
        <div className={cn("overflow-x-auto", renderMobileRow && "hidden @3xl:block")}>
          {isEmpty ? (
            <div className="min-w-0">{renderEmptyState()}</div>
          ) : (
            <Table
              className={cn(columns.some((col) => col.width) && "table-fixed", tableClassName)}
              style={
                tableClassName?.includes("min-w-")
                  ? undefined
                  : { minWidth: fixedLayoutMinWidth(columns, Boolean(selectable)) }
              }
            >
              <TableHeader>
                <TooltipProvider>
                  <TableRow className="hover:bg-transparent">
                    {selectable && (
                      <TableHead className="w-10">
                        <Checkbox
                          checked={allSelected}
                          onCheckedChange={toggleAll}
                          aria-label={t("selectAll")}
                        />
                      </TableHead>
                    )}
                    {columns.map((col) => {
                      const level = sort.findIndex((key) => key.id === col.id);
                      const key = level >= 0 ? sort[level] : null;
                      const button = (
                        <button
                          type="button"
                          onClick={(event) => toggleSort(col.id, event.shiftKey)}
                          className="button-interaction touch-target text-muted-foreground hover:text-foreground inline-flex min-h-(--target-min) select-none items-center gap-1 font-medium transition-colors"
                          aria-label={
                            key && sort.length > 1
                              ? t("sortByLevel", {
                                  column: columnName(col),
                                  level: level + 1,
                                  direction: t(
                                    key.dir === "asc" ? "sortAscending" : "sortDescending",
                                  ),
                                })
                              : t("sortBy", { column: columnName(col) })
                          }
                        >
                          {col.header}
                          {key ? (
                            key.dir === "asc" ? (
                              <ArrowUpIcon aria-hidden="true" className="size-3.5" />
                            ) : (
                              <ArrowDownIcon aria-hidden="true" className="size-3.5" />
                            )
                          ) : (
                            <ArrowsDownUpIcon aria-hidden="true" className="size-3.5 opacity-50" />
                          )}
                          {key && sort.length > 1 && (
                            <span aria-hidden="true" className="text-[11px] tabular-nums">
                              {level + 1}
                            </span>
                          )}
                        </button>
                      );
                      return (
                        <TableHead
                          key={col.id}
                          // ARIA expects aria-sort on the primary key's header only.
                          aria-sort={
                            level === 0 && key
                              ? key.dir === "asc"
                                ? "ascending"
                                : "descending"
                              : col.sortValue
                                ? "none"
                                : undefined
                          }
                          className={cn(
                            alignClass[col.align ?? "left"],
                            col.width,
                            col.headerClassName,
                          )}
                        >
                          {col.sortValue ? (
                            <Tooltip>
                              <TooltipTrigger asChild>{button}</TooltipTrigger>
                              {/* Once a sort exists, hint that Shift+click adds a tiebreaker. */}
                              {sort.length > 0 && (
                                <TooltipContent>{t("sortAddHint")}</TooltipContent>
                              )}
                            </Tooltip>
                          ) : (
                            col.header
                          )}
                        </TableHead>
                      );
                    })}
                    {rowInteractionCol > 0 && (
                      <TableHead className="w-12">
                        <span className="sr-only">{t("openRow")}</span>
                      </TableHead>
                    )}
                    {rowActions && (
                      <TableHead className="w-12">
                        <span className="sr-only">{t("actionsColumn")}</span>
                      </TableHead>
                    )}
                  </TableRow>
                </TooltipProvider>
              </TableHeader>
              <TableBody>
                {error ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={colCount} className="p-4">
                      <ContextualError message={error.message} onRetry={error.onRetry} />
                    </TableCell>
                  </TableRow>
                ) : loading ? (
                  Array.from({ length: pageSize ?? 5 }, (_, i) => `skeleton-row-${i}`).map(
                    (rowKey) => (
                      <TableRow key={rowKey} className="hover:bg-transparent">
                        {Array.from({ length: colCount }, (_, j) => `${rowKey}-cell-${j}`).map(
                          (cellKey) => (
                            <TableCell key={cellKey}>
                              <Skeleton className="h-4 w-full max-w-32" />
                            </TableCell>
                          ),
                        )}
                      </TableRow>
                    ),
                  )
                ) : (
                  rows.map((row) => {
                    const rowId = getRowId(row);
                    const checked = selectable && selectedIds?.has(rowId);
                    const rowHref = getRowHref?.(row) ?? null;
                    const interactive = rowInteractionCol > 0 && (rowHref !== null || !getRowHref);
                    const rowProps = {
                      className: interactive ? "cursor-pointer" : undefined,
                      // Row navigation is a router.push: prefetch the record on intent.
                      onPointerEnter: rowHref ? () => router.prefetch(rowHref) : undefined,
                      onClick: interactive
                        ? () => (rowHref ? router.push(rowHref) : onRowClick?.(row))
                        : undefined,
                    };
                    const cells = (
                      <>
                        {selectable && (
                          <TableCell className="w-10" onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              checked={checked}
                              onCheckedChange={() => toggleOne(rowId)}
                              aria-label={t("selectRow")}
                            />
                          </TableCell>
                        )}
                        {columns.map((col) => (
                          <DataTableCell
                            key={col.id}
                            className={cn(alignClass[col.align ?? "left"], col.className)}
                          >
                            {col.cell(row)}
                          </DataTableCell>
                        ))}
                        {rowInteractionCol > 0 && (
                          <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                            {!interactive ? null : rowHref ? (
                              <IconButton
                                variant="ghost"
                                size="icon-lg"
                                className="md:size-[var(--control-height-compact)]"
                                asChild
                                label={getRowLabel?.(row) ?? rowId}
                              >
                                <Link href={rowHref} aria-label={getRowLabel?.(row) ?? rowId}>
                                  <CaretRightIcon className="size-4" aria-hidden="true" />
                                </Link>
                              </IconButton>
                            ) : (
                              <IconButton
                                type="button"
                                variant="ghost"
                                size="icon-lg"
                                className="md:size-[var(--control-height-compact)]"
                                onClick={() => onRowClick?.(row)}
                                label={getRowLabel?.(row) ?? rowId}
                              >
                                <CaretRightIcon className="size-4" aria-hidden="true" />
                              </IconButton>
                            )}
                          </TableCell>
                        )}
                        {rowActions && (
                          <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                            {rowActions(row)}
                          </TableCell>
                        )}
                      </>
                    );
                    return renderRow ? (
                      renderRow(row, rowProps, cells)
                    ) : (
                      <TableRow key={rowId} {...rowProps}>
                        {cells}
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          )}
        </div>
        {renderMobileRow && (
          <div className="@3xl:hidden">
            {error ? (
              <div className="p-4">
                <ContextualError message={error.message} onRetry={error.onRetry} />
              </div>
            ) : loading ? (
              <div className="space-y-3 p-4">
                {Array.from(
                  { length: Math.min(pageSize ?? 5, 5) },
                  (_, i) => `mobile-skeleton-${i}`,
                ).map((rowKey) => (
                  <div key={rowKey} className="space-y-2 rounded-md border p-3">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-full max-w-56" />
                    <Skeleton className="h-3 w-2/3" />
                  </div>
                ))}
              </div>
            ) : rows.length === 0 ? (
              <div className="p-4">{renderEmptyState()}</div>
            ) : (
              <>
                {sortableColumns.length > 0 && (
                  // Narrow lists have no column headers to click, so the same
                  // persisted sort is exposed as a field picker + direction.
                  <div className="flex items-center gap-2 border-b px-4 py-2">
                    <Select
                      value={mobileSort?.id ?? DEFAULT_SORT}
                      onValueChange={(id) => {
                        setSort(id === DEFAULT_SORT ? [] : [{ id, dir: mobileSort?.dir ?? "asc" }]);
                        setPage(0);
                      }}
                    >
                      <SelectTrigger
                        size="sm"
                        aria-label={t("sortOrder")}
                        className="min-w-0 flex-1"
                      >
                        <ArrowsDownUpIcon aria-hidden="true" className="text-muted-foreground" />
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={DEFAULT_SORT}>{t("defaultOrder")}</SelectItem>
                        {sortableColumns.map((col) => (
                          <SelectItem key={col.id} value={col.id}>
                            {columnName(col)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {mobileSort && (
                      <IconButton
                        type="button"
                        variant="outline"
                        size="icon-sm"
                        label={t(mobileSort.dir === "asc" ? "sortAscending" : "sortDescending")}
                        onClick={() => {
                          setSort([
                            { id: mobileSort.id, dir: mobileSort.dir === "asc" ? "desc" : "asc" },
                            ...sort.slice(1),
                          ]);
                          setPage(0);
                        }}
                      >
                        {mobileSort.dir === "asc" ? (
                          <ArrowUpIcon aria-hidden="true" />
                        ) : (
                          <ArrowDownIcon aria-hidden="true" />
                        )}
                      </IconButton>
                    )}
                  </div>
                )}
                <ul className="divide-border divide-y">
                  {rows.map((row) => (
                    <li key={getRowId(row)}>{renderMobileRow(row)}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
        {pageSize && (sorted.length > pageSize || pageSizeOptions) && (
          <nav
            className="flex flex-wrap items-center justify-between gap-3 border-t p-3"
            aria-label={t("tablePagination")}
          >
            {pageSizeOptions && (
              <div className="flex items-center gap-2">
                <label htmlFor={pageSizeId} className="text-muted-foreground text-xs">
                  {t("rowsPerPage")}
                </label>
                <Select
                  value={String(pageSize)}
                  onValueChange={(value) => {
                    setPreferredPageSize(Number(value));
                    setPage(0);
                  }}
                >
                  <SelectTrigger id={pageSizeId} size="sm" disabled={loading}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {pageSizeOptions.map((size) => (
                      <SelectItem key={size} value={String(size)}>
                        {size}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <span
              role="status"
              aria-live="polite"
              className="text-muted-foreground text-xs tabular-nums"
            >
              {t("paginationSummary", {
                start: sorted.length ? current * pageSize + 1 : 0,
                end: Math.min((current + 1) * pageSize, sorted.length),
                total: sorted.length,
                page: current + 1,
                pages: pageCount,
              })}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={current === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                {t("previous")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={current >= pageCount - 1}
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              >
                {t("next")}
              </Button>
            </div>
          </nav>
        )}
        {selectable && (
          <p role="status" aria-live="polite" className="sr-only">
            {t("selectionCount", { count: selectedCount })}
          </p>
        )}
      </Card>
    </div>
  );
}
