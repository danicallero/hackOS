"use client";

import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon, type LucideIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { EmptyState } from "@/components/common/empty-state";
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
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  getRowId: (row: T) => string;
  /** Trailing actions cell (e.g. a "…" dropdown). */
  rowActions?: (row: T) => React.ReactNode;
  onRowClick?: (row: T) => void;
  /** Provide searchable text per row to show a filter box. */
  searchable?: (row: T) => string;
  searchPlaceholder?: string;
  /** Extra toolbar content, right-aligned (e.g. a Columns toggle, a button). */
  toolbar?: React.ReactNode;
  /** Enable client-side pagination at this page size. */
  pageSize?: number;
  loading?: boolean;
  empty?: { icon?: LucideIcon; title: string; description?: string };
  className?: string;
  /** Enable row selection via checkboxes. */
  selectable?: boolean;
  selectedIds?: Set<string>;
  onSelectionChange?: (ids: Set<string>) => void;
}

const alignClass = { left: "text-left", right: "text-right", center: "text-center" } as const;

/**
 * One table for the whole app. Columns are described declaratively (header +
 * cell renderer + optional sortValue), and search, sorting, pagination, row
 * actions, loading and empty states are all built in and prop-driven — so
 * every list (containers, users, applications, queue…) looks and behaves the
 * same. It never assumes a data shape: `cell`/`sortValue`/`searchable` are
 * callbacks over your row type.
 */
export function DataTable<T>({
  columns,
  data,
  getRowId,
  rowActions,
  onRowClick,
  searchable,
  searchPlaceholder = "Filter…",
  toolbar,
  pageSize,
  loading,
  empty,
  className,
  selectable,
  selectedIds,
  onSelectionChange,
}: DataTableProps<T>) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ id: string; dir: "asc" | "desc" } | null>(null);
  const [page, setPage] = useState(0);

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

  const pageCount = pageSize ? Math.max(1, Math.ceil(sorted.length / pageSize)) : 1;
  const current = Math.min(page, pageCount - 1);
  const rows = pageSize ? sorted.slice(current * pageSize, current * pageSize + pageSize) : sorted;

  const toggleSort = (id: string) =>
    setSort((s) =>
      s?.id === id ? (s.dir === "asc" ? { id, dir: "desc" } : null) : { id, dir: "asc" },
    );

  const showToolbar = Boolean(searchable || toolbar);
  const checkboxCol = selectable ? 1 : 0;
  const colCount = columns.length + checkboxCol + (rowActions ? 1 : 0);

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

  return (
    <Card className={cn("gap-0 overflow-hidden py-0", className)}>
      {showToolbar && (
        <div className="flex items-center gap-2 p-4">
          {searchable && (
            <Input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
              placeholder={searchPlaceholder}
              className="h-9 max-w-xs"
            />
          )}
          {toolbar && <div className="ml-auto flex items-center gap-2">{toolbar}</div>}
        </div>
      )}
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {selectable && (
                <TableHead className="w-10">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={toggleAll}
                    aria-label="Select all"
                  />
                </TableHead>
              )}
              {columns.map((col) => (
                <TableHead
                  key={col.id}
                  className={cn(alignClass[col.align ?? "left"], col.width, col.headerClassName)}
                >
                  {col.sortValue ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(col.id)}
                      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 font-medium transition-colors"
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
              {rowActions && <TableHead className="w-12" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
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
                  <EmptyState
                    icon={empty?.icon}
                    title={empty?.title ?? "Nothing to show"}
                    description={empty?.description}
                  />
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                const rowId = getRowId(row);
                const checked = selectable && selectedIds?.has(rowId);
                return (
                  <TableRow
                    key={rowId}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={cn(onRowClick && "cursor-pointer")}
                  >
                    {selectable && (
                      <TableCell className="w-10" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => toggleOne(rowId)}
                          aria-label="Select row"
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
      {pageSize && sorted.length > pageSize && (
        <div className="flex items-center justify-between gap-2 border-t p-3">
          <span className="text-muted-foreground text-xs">
            {current * pageSize + 1}–{Math.min((current + 1) * pageSize, sorted.length)} of{" "}
            {sorted.length}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={current === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={current >= pageCount - 1}
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
