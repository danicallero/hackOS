"use client";

// Searchable timezone selector (settings audit: "replace free-form timezone
// entry with a searchable timezone selector"). Built on the IANA list the
// runtime already ships (Intl.supportedValuesOf), so it never drifts from
// what the server accepts — no separate catalogue to keep in sync.

import { CheckIcon, ChevronsUpDownIcon } from "lucide-react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { useMemo, useState } from "react";
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

const FALLBACK_ZONES = [
  "UTC",
  "Europe/Madrid",
  "Europe/Lisbon",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "America/Mexico_City",
  "America/Bogota",
  "America/Sao_Paulo",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Australia/Sydney",
];

function allTimeZones(): string[] {
  try {
    // Not in every TS lib target yet; supported by all runtimes this app ships on.
    const list = (
      Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
    ).supportedValuesOf?.("timeZone");
    if (list && list.length > 0) return list;
  } catch {
    // fall through to the static list
  }
  return FALLBACK_ZONES;
}

function offsetLabel(zone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      timeZoneName: "shortOffset",
    }).formatToParts(new Date());
    const name = parts.find((p) => p.type === "timeZoneName")?.value;
    return name ?? "";
  } catch {
    return "";
  }
}

export function TimezonePicker({
  value,
  onChange,
  disabled,
  inDialog = false,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  /**
   * Set true when this lives inside a <Modal>/<Dialog> so the popover portals
   * into the dialog panel via `useDialogPortal` — see `MultiSelect`.
   */
  inDialog?: boolean;
  className?: string;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const zones = useMemo(() => allTimeZones(), []);
  const { ref: anchorRef, portalProps, contentProps } = useDialogPortal(inDialog);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return zones.slice(0, 50);
    return zones.filter((zone) => zone.toLowerCase().replace(/_/g, " ").includes(q)).slice(0, 50);
  }, [zones, query]);

  const currentOffset = value ? offsetLabel(value) : "";

  function select(zone: string) {
    onChange(zone);
    setOpen(false);
  }

  const content = (
    <PopoverPrimitive.Content
      align="start"
      sideOffset={4}
      collisionPadding={8}
      {...contentProps}
      className="bg-popover text-popover-foreground z-50 flex max-h-[var(--radix-popover-content-available-height)] w-[var(--radix-popover-trigger-width)] flex-col rounded-md border shadow-md outline-hidden"
    >
      <Command shouldFilter={false}>
        <CommandInput
          placeholder={t("searchTimezonePlaceholder")}
          value={query}
          onValueChange={setQuery}
        />
        <CommandList className="max-h-64 min-h-0 flex-1">
          {filtered.length === 0 && <CommandEmpty>{t("noTimezoneMatch")}</CommandEmpty>}
          <CommandGroup>
            {filtered.map((zone) => (
              <CommandItem key={zone} value={zone} onSelect={() => select(zone)}>
                <CheckIcon className={cn("size-4", zone === value ? "opacity-100" : "opacity-0")} />
                <span className="flex-1 truncate">{zone.replace(/_/g, " ")}</span>
                <span className="text-muted-foreground text-xs tabular-nums">
                  {offsetLabel(zone)}
                </span>
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
        <Button
          ref={anchorRef}
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn("h-auto min-h-10 w-full justify-between px-3 py-2 font-normal", className)}
        >
          <span className={cn("flex-1 truncate text-left", !value && "text-muted-foreground")}>
            {value ? value.replace(/_/g, " ") : t("selectTimezonePlaceholder")}
          </span>
          <span className="flex shrink-0 items-center gap-2">
            {currentOffset && (
              <span className="text-muted-foreground text-xs tabular-nums">{currentOffset}</span>
            )}
            <ChevronsUpDownIcon className="text-muted-foreground size-4" />
          </span>
        </Button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal {...portalProps}>{content}</PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
