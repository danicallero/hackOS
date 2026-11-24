"use client";

import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { useEffect, useId, useRef, useState } from "react";
import { IconButton } from "@/components/common/icon-button";
import { ShortcutKbd } from "@/components/common/shortcut-hint";
import { Input } from "@/components/ui/input";
import { useLocale } from "@/lib/i18n";
import { ariaKeyShortcuts, SEARCH_SHORTCUT_ATTR, SHORTCUTS } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";

export interface SearchFieldProps {
  id?: string;
  label: string;
  placeholder?: string;
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  /**
   * For short lists: an icon button that expands in place (click or `/`) and
   * folds back on Escape or blur while empty. Long lists keep the field open.
   */
  collapsible?: boolean;
}

/** Labeled shadcn search input with one shared icon, clear action and focus behavior; `/` focuses it (#1182). */
export function SearchField({
  id,
  label,
  placeholder,
  value,
  onValueChange,
  className,
  inputRef: providedRef,
  collapsible = false,
}: SearchFieldProps) {
  const generatedId = useId();
  const [expanded, setExpanded] = useState(false);
  const focusOnOpen = useRef(false);
  const inputId = id ?? generatedId;
  const ownRef = useRef<HTMLInputElement>(null);
  const inputRef = providedRef ?? ownRef;
  const { t } = useLocale();
  const open = !collapsible || expanded || value !== "";
  useEffect(() => {
    if (open && focusOnOpen.current) {
      focusOnOpen.current = false;
      inputRef.current?.focus();
    }
  }, [open, inputRef]);
  if (!open)
    return (
      <div className={cn("flex min-w-0 justify-end", className)}>
        <IconButton
          variant="outline"
          label={label}
          aria-keyshortcuts={ariaKeyShortcuts(SHORTCUTS.focusSearch, false)}
          {...{ [SEARCH_SHORTCUT_ATTR]: "" }}
          onClick={() => {
            focusOnOpen.current = true;
            setExpanded(true);
          }}
        >
          <MagnifyingGlassIcon aria-hidden="true" />
        </IconButton>
      </div>
    );
  return (
    <div
      className={cn(
        "relative min-w-0",
        collapsible && "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-150",
        className,
      )}
    >
      <label htmlFor={inputId} className="sr-only">
        {label}
      </label>
      <MagnifyingGlassIcon
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        ref={inputRef}
        id={inputId}
        type="search"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        onBlur={() => collapsible && value === "" && setExpanded(false)}
        onKeyDown={(event) => {
          if (collapsible && event.key === "Escape" && value === "") {
            setExpanded(false);
          }
        }}
        placeholder={placeholder ?? label}
        className="pr-9 pl-9 [&::-webkit-search-cancel-button]:appearance-none"
        {...{ [SEARCH_SHORTCUT_ATTR]: "" }}
        aria-keyshortcuts={ariaKeyShortcuts(SHORTCUTS.focusSearch, false)}
      />
      {/* An input keeps its hint inline: a tooltip would cover the list while typing. */}
      {!value && (
        <ShortcutKbd
          shortcut="focusSearch"
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 right-2.5 hidden -translate-y-1/2 pointer-fine:inline-flex"
        />
      )}
      {value && (
        <div className="absolute inset-y-0 right-0.5 z-10 flex items-center">
          <IconButton
            variant="ghost"
            size="icon-sm"
            label={t("clearSearch")}
            onClick={() => {
              onValueChange("");
              inputRef.current?.focus();
            }}
          >
            <XIcon aria-hidden="true" />
          </IconButton>
        </div>
      )}
    </div>
  );
}
