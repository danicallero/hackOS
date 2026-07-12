"use client";

import { CheckIcon, ChevronsUpDownIcon, XIcon } from "lucide-react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export interface MultiSelectOption {
  value: string;
  label: string;
  description?: string;
}

/**
 * One multi-select for the whole app (food intolerances, capabilities on a
 * group, filters…). Options are `{ value, label, description }`; `value` is a
 * string[] of selected values. Fully controlled and prop-driven.
 *
 * `inDialog`: when this lives inside a <Modal>/<Dialog>, set it true so the
 * popover renders WITHOUT a portal. A portaled popover lands outside the
 * dialog's scroll-lock (react-remove-scroll), which silently blocks scrolling
 * the option list. Rendered inline it stays inside the lock scope and scrolls.
 * Outside a dialog keep the default (portaled) so overflow-hidden ancestors
 * like SectionCard don't clip it.
 */
export function MultiSelect({
  options,
  value,
  onChange,
  placeholder,
  searchPlaceholder,
  emptyText,
  disabled,
  inDialog = false,
  className,
}: {
  options: MultiSelectOption[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  inDialog?: boolean;
  className?: string;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const selected = new Set(value);
  const toggle = (v: string) =>
    onChange(selected.has(v) ? value.filter((x) => x !== v) : [...value, v]);
  const labelOf = (v: string) => options.find((o) => o.value === v)?.label ?? v;

  const content = (
    <PopoverPrimitive.Content
      align="start"
      sideOffset={4}
      className="bg-popover text-popover-foreground z-50 w-[--radix-popover-trigger-width] rounded-md border shadow-md outline-hidden"
    >
      <Command>
        <CommandInput placeholder={searchPlaceholder ?? t("genericSearchPlaceholder")} />
        <CommandList className="max-h-64">
          <CommandEmpty>{emptyText ?? t("noResultsLabel")}</CommandEmpty>
          <CommandGroup>
            {options.map((opt) => (
              <CommandItem key={opt.value} value={opt.label} onSelect={() => toggle(opt.value)}>
                <div
                  className={cn(
                    "border-primary flex size-4 items-center justify-center rounded-sm border",
                    selected.has(opt.value) ? "bg-primary text-primary-foreground" : "opacity-60",
                  )}
                >
                  {selected.has(opt.value) && <CheckIcon className="size-3" />}
                </div>
                <div className="flex flex-col">
                  <span>{opt.label}</span>
                  {opt.description && (
                    <span className="text-muted-foreground text-xs">{opt.description}</span>
                  )}
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </PopoverPrimitive.Content>
  );

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <div
          role="combobox"
          tabIndex={disabled ? -1 : 0}
          aria-disabled={disabled}
          aria-expanded={open}
          className={cn(
            buttonVariants({ variant: "outline" }),
            "h-auto min-h-10 w-full justify-between px-3 py-2 font-normal",
            disabled && "pointer-events-none opacity-50",
            className,
          )}
        >
          <span className="flex flex-1 flex-wrap gap-1">
            {value.length === 0 ? (
              <span className="text-muted-foreground">{placeholder ?? t("selectPlaceholder")}</span>
            ) : (
              value.map((v) => (
                <Badge key={v} variant="secondary" className="gap-1">
                  {labelOf(v)}
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label={t("removeItemLabel", { name: labelOf(v) })}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle(v);
                    }}
                    className="hover:text-foreground text-muted-foreground"
                  >
                    <XIcon className="size-3" />
                  </button>
                </Badge>
              ))
            )}
          </span>
          <ChevronsUpDownIcon className="text-muted-foreground size-4 shrink-0" />
        </div>
      </PopoverPrimitive.Trigger>
      {inDialog ? content : <PopoverPrimitive.Portal>{content}</PopoverPrimitive.Portal>}
    </PopoverPrimitive.Root>
  );
}
