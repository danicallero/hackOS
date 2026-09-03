"use client";

import {
  ArrowDownIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  ChevronRightIcon,
  type LucideIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef } from "react";
import { ActionGroup } from "@/components/common/action-group";
import { ContextualError } from "@/components/common/contextual-error";
import { EmptyState } from "@/components/common/empty-state";
import { IconButton } from "@/components/common/icon-button";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usePersistedState } from "@/hooks/use-persisted-state";
import { useScrollRestoration } from "@/hooks/use-scroll-restoration";
import { useLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

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
  /** e.g. "w-40" or "min-w-48". */
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
  /** Native link destination rendered in its own table cell. */
  getRowHref?: (row: T) => string;
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
  loading?: boolean;
  empty?: { icon?: LucideIcon; title: string; description?: string; action?: React.ReactNode };
  filteredEmpty?: {
    active: boolean;
    onClear: () => void;
    title?: string;
  };
  error?: { message: string; onRetry?: () => void };
  /** Persistent mutation feedback that leaves the current rows available. */
  mutationError?: { message: string; onRetry?: () => void };
  className?: string;
  /** Enable row selection via checkboxes. */
  selectable?: boolean;
  selectedIds?: Set<string>;
  onSelectionChange?: (ids: Set<string>) => void;
  /**
   * Opt in to this table's search/sort/page and window scroll position
   * surviving a trip to a detail page and back (BackLink's router.back()).
   * Must be unique per table instance on the page (e.g. "audit-list").
   */
  stateKey?: string;
  /** Fires with the current search/sort-applied (but not yet paginated) row
   *  order — lets a caller page through rows in the order actually on
   *  screen, e.g. prev/next inside a detail modal. */
  onVisibleRowsChange?: (rows: T[]) => void;
}

const alignClass = { left: "text-left", right: "text-right", center: "text-center" } as const;

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
  pageSize,
  loading,
  empty,
  filteredEmpty,
  error,
  mutationError,
  className,
  selectable,
  selectedIds,
  onSelectionChange,
  stateKey,
  onVisibleRowsChange,
}: DataTableProps<T>) {
  const { t } = useLocale();
  const [query, setQuery] = usePersistedState(stateKey ? `${stateKey}:query` : null, "");
  const [sort, setSort] = usePersistedState<{ id: string; dir: "asc" | "desc" } | null>(
    stateKey ? `${stateKey}:sort` : null,
    null,
  );
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
    const q = query.trim().toLowerCase();
    return data.filter((row) => searchable(row).toLowerCase().includes(q));
  }, [data, searchable, query]);

  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const col = columns.find((c) => c.id === sort.id);
    if (!col?.sortValue) return filtered;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = col.sortValue?.(a) ?? "";
      const bv = col.sortValue?.(b) ?? "";
      return av < bv ? -dir : av > bv ? dir : 0;
    });
  }, [filtered, sort, columns]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: onVisibleRowsChange is a caller-supplied setState-style callback, not a value this effect should re-fire on.
  useEffect(() => {
    onVisibleRowsChange?.(sorted);
  }, [sorted]);

  const pageCount = pageSize ? Math.max(1, Math.ceil(sorted.length / pageSize)) : 1;
  const current = Math.min(page, pageCount - 1);
  const rows = pageSize ? sorted.slice(current * pageSize, current * pageSize + pageSize) : sorted;

  const toggleSort = (id: string) =>
    setSort((s) =>
      s?.id === id ? (s.dir === "asc" ? { id, dir: "desc" } : null) : { id, dir: "asc" },
    );

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
        icon={empty?.icon}
        title={empty?.title ?? t("nothingToShow")}
        description={empty?.description}
        action={empty?.action}
      />
    );
  }

  return (
    <Card className={cn("gap-0 overflow-hidden py-0", className)}>
      {showToolbar && (
        <div className="flex flex-wrap items-center gap-2 p-4">
          {searchable && (
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              <div className="relative w-full max-w-xs">
                <label htmlFor={searchId} className="sr-only">
                  {searchLabel ?? t("searchTable")}
                </label>
                <SearchIcon
                  className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
                  aria-hidden="true"
                />
                <Input
                  ref={searchInputRef}
                  id={searchId}
                  type="search"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setPage(0);
                  }}
                  placeholder={searchPlaceholder ?? t("filterPlaceholder")}
                  className="pr-9 pl-9"
                />
                {query && (
                  <IconButton
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="absolute top-1/2 right-0.5 -translate-y-1/2"
                    onClick={clearSearch}
                    label={t("clearSearch")}
                  >
                    <XIcon className="size-4" aria-hidden="true" />
                  </IconButton>
                )}
              </div>
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
        </div>
      )}
      {mutationError && (
        <ContextualError
          message={mutationError.message}
          onRetry={mutationError.onRetry}
          className="m-4"
        />
      )}
      <div className={cn("overflow-x-auto", renderMobileRow && "hidden md:block")}>
        <Table>
          <TableHeader>
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
              {columns.map((col) => (
                <TableHead
                  key={col.id}
                  aria-sort={
                    sort?.id === col.id
                      ? sort.dir === "asc"
                        ? "ascending"
                        : "descending"
                      : col.sortValue
                        ? "none"
                        : undefined
                  }
                  className={cn(alignClass[col.align ?? "left"], col.width, col.headerClassName)}
                >
                  {col.sortValue ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(col.id)}
                      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 font-medium transition-colors"
                      aria-label={t("sortBy", {
                        column:
                          col.sortLabel ?? (typeof col.header === "string" ? col.header : col.id),
                      })}
                    >
                      {col.header}
                      {sort?.id === col.id ? (
                        sort.dir === "asc" ? (
                          <ArrowUpIcon className="size-3.5" />
                        ) : (
                          <ArrowDownIcon className="size-3.5" />
                        )
                      ) : (
                        <ArrowUpDownIcon className="size-3.5 opacity-50" />
                      )}
                    </button>
                  ) : (
                    col.header
                  )}
                </TableHead>
              ))}
              {rowInteractionCol > 0 && (
                <TableHead className="w-12">
                  <span className="sr-only">{t("openRow")}</span>
                </TableHead>
              )}
              {rowActions && <TableHead className="w-12" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {error ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={colCount} className="p-4">
                  <ContextualError message={error.message} onRetry={error.onRetry} />
                </TableCell>
              </TableRow>
            ) : loading ? (
              Array.from({ length: pageSize ?? 5 }, (_, i) => `skeleton-row-${i}`).map((rowKey) => (
                <TableRow key={rowKey} className="hover:bg-transparent">
                  {Array.from({ length: colCount }, (_, j) => `${rowKey}-cell-${j}`).map(
                    (cellKey) => (
                      <TableCell key={cellKey}>
                        <Skeleton className="h-4 w-full max-w-32" />
                      </TableCell>
                    ),
                  )}
                </TableRow>
              ))
            ) : rows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={colCount} className="p-0">
                  {renderEmptyState()}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                const rowId = getRowId(row);
                const checked = selectable && selectedIds?.has(rowId);
                const rowHref = getRowHref?.(row);
                return (
                  <TableRow
                    key={rowId}
                    className={rowInteractionCol > 0 ? "cursor-pointer" : undefined}
                    onClick={
                      rowInteractionCol > 0
                        ? () => (rowHref ? router.push(rowHref) : onRowClick?.(row))
                        : undefined
                    }
                  >
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
                      <TableCell
                        key={col.id}
                        className={cn(alignClass[col.align ?? "left"], col.className)}
                      >
                        {col.cell(row)}
                      </TableCell>
                    ))}
                    {rowInteractionCol > 0 && (
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        {getRowHref ? (
                          <IconButton
                            variant="ghost"
                            size="icon-lg"
                            className="md:size-[var(--control-height-compact)]"
                            asChild
                            label={getRowLabel?.(row) ?? rowId}
                          >
                            <Link href={getRowHref(row)} aria-label={getRowLabel?.(row) ?? rowId}>
                              <ChevronRightIcon className="size-4" aria-hidden="true" />
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
                            <ChevronRightIcon className="size-4" aria-hidden="true" />
                          </IconButton>
                        )}
                      </TableCell>
                    )}
                    {rowActions && (
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        {rowActions(row)}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
      {renderMobileRow && (
        <div className="md:hidden">
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
            <ul className="divide-border divide-y">
              {rows.map((row) => (
                <li key={getRowId(row)}>{renderMobileRow(row)}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {pageSize && sorted.length > pageSize && (
        <nav
          className="flex items-center justify-between gap-2 border-t p-3"
          aria-label={t("tablePagination")}
        >
          <span
            role="status"
            aria-live="polite"
            className="text-muted-foreground text-xs tabular-nums"
          >
            {t("paginationSummary", {
              start: current * pageSize + 1,
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
  );
}
