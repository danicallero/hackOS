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
  feedback,
}: {
  search: SearchFieldProps;
  filters?: readonly FilterDefinition[];
  actions?: React.ReactNode;
  feedback?: React.ReactNode;
}) {
  const { t } = useLocale();
  const isMobile = useIsMobile();
  const hasFilters = Boolean(filters?.length);
  return (
    <div className="space-y-3">
      <PageToolbar
        label={t("pageDataControls")}
        className={cn(
          "grid items-center gap-2",
          hasFilters && actions
            ? "grid-cols-[minmax(0,1fr)_auto_auto]"
            : hasFilters || actions
              ? "grid-cols-[minmax(0,1fr)_auto]"
              : "grid-cols-1",
        )}
      >
        <SearchField {...search} />
        {hasFilters && (
          <FilterMenu
            filters={filters!}
            iconOnly={isMobile}
            className="contents"
            chipsClassName="col-span-full row-start-2 flex flex-nowrap gap-2 overflow-x-auto overscroll-x-contain pb-1"
          />
        )}
        {actions}
      </PageToolbar>
      {feedback}
    </div>
  );
}
