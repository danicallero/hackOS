"use client";

// Type-ahead combobox over an already-loaded, in-memory option list — for
// pickers like "enterprise" or "activity" where the full set is small enough
// to fetch once but too long to scan as a flat native <select> (H43, H26).
// Filters client-side via cmdk's built-in fuzzy match. For a picker backed by
// a paginated/server-searched endpoint instead, use UserPicker's pattern.

import { CheckIcon, ChevronsUpDownIcon } from "lucide-react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useDialogPortal } from "@/hooks/use-dialog-portal";
import { useLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function EntityCombobox<T>({
  options,
  value,
  onChange,
  getId,
  getLabel,
  disabled,
  inDialog = false,
  className,
  placeholder,
  searchPlaceholder,
  emptyText,
  id,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
}: {
  options: T[];
  /** Selected option id as a string, or "" when unset. */
  value: string;
  onChange: (value: string) => void;
  /** Extracts the id `value` compares against, from an option. */
  getId: (option: T) => string | number;
  /** Extracts the display/searchable text for an option. */
  getLabel: (option: T) => string;
  disabled?: boolean;
  inDialog?: boolean;
  className?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  id?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
}) {
  const { t } = useLocale();
  const { ref: anchorRef, portalProps, contentProps } = useDialogPortal(inDialog);
  const [open, setOpen] = useState(false);
  const listboxId = useId();

  const selected = options.find((option) => String(getId(option)) === value) ?? null;
  const label = selected ? getLabel(selected) : null;

  const content = (
    <PopoverPrimitive.Content
      align="start"
      sideOffset={4}
      collisionPadding={8}
      {...contentProps}
      id={listboxId}
      className="bg-popover text-popover-foreground z-50 flex max-h-(--radix-popover-content-available-height) w-(--radix-popover-trigger-width) flex-col rounded-md border shadow-md outline-hidden"
    >
      <Command>
        <CommandInput placeholder={searchPlaceholder ?? t("typeToFilterEllipsis")} />
        <CommandList className="max-h-64 min-h-0 flex-1">
          <CommandEmpty>{emptyText ?? t("noMatchingResultsPeriod")}</CommandEmpty>
          <CommandGroup>
            {options.map((option) => {
              const optionId = String(getId(option));
              return (
                <CommandItem
                  key={optionId}
                  value={`${optionId} ${getLabel(option)}`}
                  onSelect={() => {
                    onChange(optionId);
                    setOpen(false);
                  }}
                >
                  <CheckIcon
                    aria-hidden="true"
                    className={cn("size-4", optionId === value ? "opacity-100" : "opacity-0")}
                  />
                  {getLabel(option)}
                </CommandItem>
              );
            })}
          </CommandGroup>
        </CommandList>
      </Command>
    </PopoverPrimitive.Content>
  );

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <Button
          ref={anchorRef}
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-labelledby={ariaLabelledBy}
          aria-describedby={ariaDescribedBy}
          className={cn("w-full justify-between font-normal", className)}
        >
          <span className={cn("flex-1 truncate text-left", !label && "text-muted-foreground")}>
            {label ?? placeholder ?? t("typeToFilterEllipsis")}
          </span>
          <ChevronsUpDownIcon
            aria-hidden="true"
            className="text-muted-foreground size-4 shrink-0"
          />
        </Button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal {...portalProps}>{content}</PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
