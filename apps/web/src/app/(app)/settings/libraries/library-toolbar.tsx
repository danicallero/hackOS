"use client";

import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { useId, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLocale } from "@/lib/i18n";
import { LibraryAddButton } from "./library-add-button";

export function LibraryToolbar({
  search,
  onSearchChange,
  searchLabel,
  count,
  addLabel,
  onAdd,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  searchLabel: string;
  count: number;
  addLabel: string;
  onAdd: () => void;
}) {
  const { t } = useLocale();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="@container flex items-center gap-2">
      <div className="relative min-w-0 max-w-xs flex-1">
        <label htmlFor={id} className="sr-only">
          {searchLabel}
        </label>
        <MagnifyingGlassIcon
          aria-hidden="true"
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
        />
        <Input
          ref={input}
          id={id}
          type="search"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={searchLabel}
          className="pr-9 pl-9"
        />
        {search && (
          <div className="absolute inset-y-0 right-0.5 z-10 flex items-center">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("clearSearch")}
              onClick={() => {
                onSearchChange("");
                input.current?.focus();
              }}
            >
              <XIcon aria-hidden="true" className="size-4" />
            </Button>
          </div>
        )}
      </div>
      <span
        role="status"
        aria-live="polite"
        className="text-muted-foreground shrink-0 text-xs tabular-nums"
      >
        {t("tableResultCount", { count })}
      </span>
      <div className="ml-auto shrink-0">
        <LibraryAddButton label={addLabel} onClick={onAdd} />
      </div>
    </div>
  );
}
