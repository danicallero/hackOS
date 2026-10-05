"use client";

import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { useId, useRef } from "react";
import { IconButton } from "@/components/common/icon-button";
import { Input } from "@/components/ui/input";
import { useLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export interface SearchFieldProps {
  id?: string;
  label: string;
  placeholder?: string;
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}

/** Labelled shadcn search input with one shared icon, clear action and focus behavior. */
export function SearchField({
  id,
  label,
  placeholder,
  value,
  onValueChange,
  className,
  inputRef: providedRef,
}: SearchFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const ownRef = useRef<HTMLInputElement>(null);
  const inputRef = providedRef ?? ownRef;
  const { t } = useLocale();
  return (
    <div className={cn("relative min-w-0", className)}>
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
        placeholder={placeholder ?? label}
        className="pr-9 pl-9"
      />
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
