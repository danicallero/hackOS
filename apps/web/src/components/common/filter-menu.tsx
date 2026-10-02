"use client";

import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { FunnelIcon } from "@phosphor-icons/react/dist/csr/Funnel";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useIsMobile } from "@/hooks/use-mobile";
import { useLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export interface FilterOption {
  value: string;
  label: string;
}

type FilterDefinition = {
  id: string;
  label: string;
  icon: PhosphorIcon;
  options: readonly FilterOption[];
} & (
  | {
      type: "single";
      value: string;
      resetValue: string;
      onChange: (value: string) => void;
    }
  | {
      type: "multiple";
      value: readonly string[];
      onChange: (value: string[]) => void;
    }
);

function activeValues(filter: FilterDefinition): readonly string[] {
  return filter.type === "multiple"
    ? filter.value
    : filter.value === filter.resetValue
      ? []
      : [filter.value];
}

function clearFilter(filter: FilterDefinition) {
  if (filter.type === "multiple") filter.onChange([]);
  else filter.onChange(filter.resetValue);
}

/** One categorical filter menu; controlled values stay owned by each list. */
export function FilterMenu({
  filters,
  className,
}: {
  filters: readonly FilterDefinition[];
  className?: string;
}) {
  const { t } = useLocale();
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [mobileFilterId, setMobileFilterId] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const mobileFilter = filters.find((filter) => filter.id === mobileFilterId);
  const active = filters.filter((filter) => activeValues(filter).length > 0);

  // Replacing the mobile category list must move focus into its new menu.
  useEffect(() => {
    if (!open || !isMobile) return;
    const selector = mobileFilterId ? "[data-filter-menu-back]" : '[role^="menuitem"]';
    contentRef.current?.querySelector<HTMLElement>(selector)?.focus();
  }, [open, isMobile, mobileFilterId]);

  function resetAll() {
    for (const filter of active) clearFilter(filter);
  }

  return (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-2", className)}>
      <DropdownMenu
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setMobileFilterId(null);
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button ref={triggerRef} variant="outline" type="button">
            <FunnelIcon aria-hidden="true" />
            {t("filtersLabel")}
            {active.length > 0 && (
              <span className="bg-primary text-primary-foreground flex size-5 items-center justify-center rounded-full text-xs tabular-nums">
                {active.length}
              </span>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          ref={contentRef}
          align="start"
          collisionPadding={8}
          className="w-64 max-w-[calc(100vw-2rem)]"
        >
          {isMobile && mobileFilter ? (
            <>
              <DropdownMenuItem
                data-filter-menu-back
                onSelect={(event) => {
                  event.preventDefault();
                  setMobileFilterId(null);
                }}
              >
                <ArrowLeftIcon aria-hidden="true" />
                {t("back")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>{mobileFilter.label}</DropdownMenuLabel>
              <FilterOptions filter={mobileFilter} />
            </>
          ) : (
            <>
              {filters.map((filter) => {
                const Icon = filter.icon;
                const values = activeValues(filter);
                const summary =
                  filter.type === "single"
                    ? (filter.options.find((option) => option.value === filter.value)?.label ??
                      filter.value)
                    : String(values.length);
                const label = (
                  <>
                    <Icon aria-hidden="true" />
                    <span className="flex-1">{filter.label}</span>
                    {values.length > 0 && (
                      <span className="text-muted-foreground max-w-28 truncate text-xs">
                        {summary}
                      </span>
                    )}
                  </>
                );
                return isMobile ? (
                  <DropdownMenuItem
                    key={filter.id}
                    onSelect={(event) => {
                      event.preventDefault();
                      setMobileFilterId(filter.id);
                    }}
                  >
                    {label}
                    <CaretRightIcon aria-hidden="true" className="size-3.5" />
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuSub key={filter.id}>
                    <DropdownMenuSubTrigger>{label}</DropdownMenuSubTrigger>
                    <DropdownMenuSubContent
                      collisionPadding={8}
                      className="max-h-[min(24rem,var(--radix-dropdown-menu-content-available-height))] w-64 max-w-[calc(100vw-2rem)] overflow-y-auto"
                    >
                      <DropdownMenuLabel>{filter.label}</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <FilterOptions filter={filter} />
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                );
              })}
              {active.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={resetAll}>
                    <XIcon aria-hidden="true" />
                    {t("clearFilters")}
                  </DropdownMenuItem>
                </>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {active.flatMap((filter) =>
        activeValues(filter).map((value) => {
          const label = filter.options.find((option) => option.value === value)?.label ?? value;
          return (
            <Button
              key={`${filter.id}:${value}`}
              type="button"
              variant="secondary"
              size="sm"
              className="max-w-full font-normal"
              aria-label={t("removeItemLabel", { name: `${filter.label}: ${label}` })}
              onClick={() => {
                if (filter.type === "multiple") {
                  filter.onChange(filter.value.filter((selected) => selected !== value));
                } else clearFilter(filter);
                triggerRef.current?.focus();
              }}
            >
              <span className="truncate">
                {filter.label}: {label}
              </span>
              <XIcon aria-hidden="true" className="size-3.5 shrink-0" />
            </Button>
          );
        }),
      )}
    </div>
  );
}

function FilterOptions({ filter }: { filter: FilterDefinition }) {
  if (filter.type === "single") {
    return (
      <DropdownMenuRadioGroup value={filter.value} onValueChange={filter.onChange}>
        {filter.options.map((option) => (
          <DropdownMenuRadioItem key={option.value} value={option.value}>
            <span className="wrap-break-word">{option.label}</span>
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    );
  }
  return filter.options.map((option) => (
    <DropdownMenuCheckboxItem
      key={option.value}
      checked={filter.value.includes(option.value)}
      onSelect={(event) => event.preventDefault()}
      onCheckedChange={(checked) =>
        filter.onChange(
          checked
            ? [...filter.value, option.value]
            : filter.value.filter((value) => value !== option.value),
        )
      }
    >
      <span className="wrap-break-word">{option.label}</span>
    </DropdownMenuCheckboxItem>
  ));
}
