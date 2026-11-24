"use client";

import { type FilterDefinition, FilterMenu } from "@/components/common/filter-menu";
import { PageToolbar } from "@/components/common/page-toolbar";
import { SearchField, type SearchFieldProps } from "@/components/common/search-field";
import { useIsMobile } from "@/hooks/use-mobile";
import { useLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** Canonical dense-list control row, derived from the audited Users composition. */
export function ListToolbar({
  search,
  filters,
  actions,
  actionsBeforeFilters = false,
  feedback,
  searchOwnRowWhenNarrow = false,
  scope,
}: {
  /** What the list shows (segmented tabs); leads the row, so no extra row is spent on it. */
  scope?: React.ReactNode;
  search: SearchFieldProps;
  filters?: readonly FilterDefinition[];
  actions?: React.ReactNode;
  /** Puts the actions right after the search field, e.g. the button that submits it. */
  actionsBeforeFilters?: boolean;
  feedback?: React.ReactNode;
  /** In a narrow toolbar the search takes its own row so wide actions cannot shrink it (#1178). */
  searchOwnRowWhenNarrow?: boolean;
}) {
  const { t } = useLocale();
  const isMobile = useIsMobile();
  const hasFilters = Boolean(filters?.length);
  const toolbar = (
    <PageToolbar
      label={t("pageDataControls")}
      className={cn(
        "grid items-center gap-2",
        hasFilters && actions
          ? "grid-cols-[minmax(0,1fr)_auto_auto]"
          : hasFilters || actions
            ? "grid-cols-[minmax(0,1fr)_auto]"
            : "grid-cols-1",
        searchOwnRowWhenNarrow &&
          hasFilters &&
          actions &&
          "@max-2xl:grid-cols-[auto_minmax(0,1fr)]",
      )}
    >
      <SearchField
        {...search}
        className={cn(searchOwnRowWhenNarrow && "@max-2xl:col-span-full", search.className)}
      />
      {actionsBeforeFilters && actions}
      {hasFilters && (
        <FilterMenu
          filters={filters!}
          iconOnly={isMobile}
          className="contents"
          chipsClassName={cn(
            "col-span-full row-start-2 flex flex-nowrap gap-2 overflow-x-auto overscroll-x-contain pb-1",
            searchOwnRowWhenNarrow && actions && "@max-2xl:row-start-3",
          )}
        />
      )}
      {!actionsBeforeFilters && actions}
    </PageToolbar>
  );
  return (
    <div className="@container space-y-3">
      {scope ? (
        <div className="flex flex-wrap items-center gap-2">
          <div className="max-w-full shrink-0">{scope}</div>
          <div className="min-w-0 flex-1 basis-80">{toolbar}</div>
        </div>
      ) : (
        toolbar
      )}
      {feedback}
    </div>
  );
}
