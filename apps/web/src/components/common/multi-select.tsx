"use client";

import { CheckIcon, ChevronsUpDownIcon, XIcon } from "lucide-react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { useId, useState } from "react";
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
import { useDialogPortal } from "@/hooks/use-dialog-portal";
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
 * `inDialog`: set it true when this lives inside a <Modal>/<Dialog> so the
 * popover is portaled into the dialog panel — see `useDialogPortal`.
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
  id,
  name,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
}: {
  options: MultiSelectOption[];
  /** Selected option values. */
  value: string[];
  onChange: (value: string[]) => void;
  /** Shown in the trigger when nothing is selected. */
  placeholder?: string;
  /** Shown inside the popover's search input. */
  searchPlaceholder?: string;
  /** Shown when the search matches no options. */
  emptyText?: string;
  disabled?: boolean;
  inDialog?: boolean;
  className?: string;
  id?: string;
  name?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: React.AriaAttributes["aria-invalid"];
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const listboxId = useId();
  const { ref: boxRef, portalProps, contentProps } = useDialogPortal(inDialog);
  const selected = new Set(value);
  const toggle = (v: string) =>
    onChange(selected.has(v) ? value.filter((x) => x !== v) : [...value, v]);
  const labelOf = (v: string) => options.find((o) => o.value === v)?.label ?? v;

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
        <CommandInput placeholder={searchPlaceholder ?? t("genericSearchPlaceholder")} />
        <CommandList className="max-h-64 min-h-0 flex-1">
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
                  {selected.has(opt.value) && <CheckIcon aria-hidden="true" className="size-3" />}
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
      {/* Anchored on the whole control, not on the inner trigger button: the
          button is inset by the box's padding (and by any badges), so anchoring
          to it would leave the popover narrower than, and offset from, the
          field it belongs to. */}
      <PopoverPrimitive.Anchor asChild>
        <div
          ref={boxRef}
          className={cn(
            "flex min-h-10 w-full items-center gap-2 rounded-control border bg-background px-3 py-2",
            disabled && "opacity-50",
            className,
          )}
        >
          {/* Only rendered when something is selected: an empty flex-1 span would
              eat half the control and push the trigger (and its placeholder) into
              the middle of the box instead of leaving it left-aligned. */}
          {value.length > 0 && (
            <span className="flex min-w-0 flex-wrap gap-1">
              {value.map((v) => (
                <Badge key={v} variant="secondary" className="gap-1">
                  {labelOf(v)}
                  <button
                    type="button"
                    disabled={disabled}
                    aria-label={t("removeItemLabel", { name: labelOf(v) })}
                    onClick={() => toggle(v)}
                    className="hover:text-foreground text-muted-foreground inline-flex size-6 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    <XIcon aria-hidden="true" className="size-3" />
                  </button>
                </Badge>
              ))}
            </span>
          )}
          <PopoverPrimitive.Trigger asChild>
            <button
              id={id}
              name={name}
              type="button"
              disabled={disabled}
              role="combobox"
              aria-controls={listboxId}
              aria-expanded={open}
              aria-haspopup="listbox"
              aria-label={ariaLabel}
              aria-labelledby={ariaLabelledBy}
              aria-describedby={ariaDescribedBy}
              aria-invalid={ariaInvalid}
              className={cn(
                buttonVariants({ variant: "ghost" }),
                "min-w-0 flex-1 px-1 text-left font-normal",
                // With badges the label is sr-only, so the chevron is the only
                // visible child: pin it to the far edge of the control instead
                // of leaving it floating where the label used to start.
                value.length > 0 ? "justify-end" : "justify-between",
              )}
            >
              <span className={cn(value.length > 0 && "sr-only", "truncate")}>
                {value.length > 0
                  ? t("selectedCount", { count: value.length })
                  : (placeholder ?? t("selectPlaceholder"))}
              </span>
              <ChevronsUpDownIcon
                aria-hidden="true"
                className="text-muted-foreground size-4 shrink-0"
              />
            </button>
          </PopoverPrimitive.Trigger>
        </div>
      </PopoverPrimitive.Anchor>
      <PopoverPrimitive.Portal {...portalProps}>{content}</PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
