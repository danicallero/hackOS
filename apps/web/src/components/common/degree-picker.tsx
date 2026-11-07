"use client";

import { CaretUpDownIcon } from "@phosphor-icons/react/dist/csr/CaretUpDown";
// Curated degree autocomplete. It mirrors the university directory's proposal
// limits on the API and stores only the stable catalogue id in a response.
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { Popover as PopoverPrimitive } from "radix-ui";
import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useDebouncedSearch } from "@/hooks/use-debounced-search";
import { useDialogPortal } from "@/hooks/use-dialog-portal";
import { api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { normalizeSearchText } from "@/lib/search-text";
import { readServerState } from "@/lib/server-state";
import { useSessionContext } from "@/lib/session";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

interface Degree {
  id: number;
  name: string;
}
type Props = {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  disabled?: boolean;
  inDialog?: boolean;
  id?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: React.AriaAttributes["aria-invalid"];
  "aria-required"?: React.AriaAttributes["aria-required"];
};

export function DegreePicker({
  value,
  onChange,
  onBlur,
  disabled,
  inDialog = false,
  id,
  ...aria
}: Props) {
  const { t } = useLocale();
  const { status } = useSessionContext();
  const listboxId = useId();
  const { ref, portalProps, contentProps } = useDialogPortal(inDialog);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [resolvedLabel, setResolvedLabel] = useState<{ id: string; name: string } | null>(null);
  const trimmedQuery = query.trim();
  // Only search once the picker opens (#1227). Results carry their query so
  // stale ones read as loading until the current query has answered.
  const { result, error: searchError } = useDebouncedSearch(
    query,
    async (q) => {
      const { degrees } = await readServerState(
        ["public", "degrees", { q: q || undefined }],
        (signal) =>
          api.get<{ degrees: Degree[] }>("/api/public/degrees", {
            query: { q: q || undefined },
            signal,
          }),
      );
      return { query: q, degrees };
    },
    { enabled: open, delayMs: 200 },
  );
  const options = result?.degrees ?? [];
  const loading = !searchError && result?.query !== trimmedQuery;
  const knownLabel = value ? options.find((item) => String(item.id) === value)?.name : null;
  useEffect(() => {
    if (!value || knownLabel || resolvedLabel?.id === value) return;
    let active = true;
    readServerState(["public", "degrees", { ids: value }], (signal) =>
      api.get<{ degrees: Degree[] }>("/api/public/degrees", { query: { ids: value }, signal }),
    )
      .then(({ degrees }) => {
        const match = degrees.find((degree) => String(degree.id) === value);
        if (active && match) setResolvedLabel({ id: value, name: match.name });
      })
      .catch((error) => console.error("[degree-picker] label lookup failed", error));
    return () => {
      active = false;
    };
  }, [value, knownLabel, resolvedLabel]);
  const select = (degree: Degree) => {
    onChange(String(degree.id));
    setResolvedLabel({ id: String(degree.id), name: degree.name });
    setQuery("");
    setOpen(false);
    onBlur?.();
  };
  const propose = async () => {
    const name = query.trim();
    if (!name || status !== "authenticated") return;
    const degree = await api.post<Degree>("/api/public/degrees/propose", { name });
    toast.success(t("degreeAdded"), { compactTitle: t("toastAddDegree") });
    select(degree);
  };
  const currentLabel = knownLabel ?? (resolvedLabel?.id === value ? resolvedLabel.name : null);
  const canPropose =
    status === "authenticated" &&
    query.trim().length > 1 &&
    !loading &&
    !options.some((item) => normalizeSearchText(item.name) === normalizeSearchText(query));
  return (
    <PopoverPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) onBlur?.();
      }}
    >
      <PopoverPrimitive.Trigger asChild>
        <Button
          ref={ref}
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          onBlur={() => {
            if (!open) onBlur?.();
          }}
          role="combobox"
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setOpen(true);
            }
          }}
          aria-controls={listboxId}
          aria-expanded={open}
          aria-haspopup="dialog"
          {...aria}
          className="w-full min-w-0 max-w-full justify-between rounded-control font-normal"
        >
          <span className="min-w-0 flex-1 truncate text-left">
            {currentLabel ?? t("selectDegreePlaceholder")}
          </span>
          <CaretUpDownIcon aria-hidden="true" className="text-muted-foreground size-4 shrink-0" />
        </Button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal {...portalProps}>
        <PopoverPrimitive.Content
          {...contentProps}
          id={listboxId}
          align="start"
          sideOffset={4}
          className="pointer-events-auto bg-popover text-popover-foreground z-50 flex max-h-(--radix-popover-content-available-height) w-(--radix-popover-trigger-width) flex-col rounded-md border shadow-md"
        >
          <Command
            shouldFilter={false}
            className="min-h-0 [&_[data-slot=command-input-wrapper]]:shrink-0"
          >
            <CommandInput
              placeholder={t("searchDegreesPlaceholder")}
              value={query}
              onValueChange={setQuery}
            />
            <CommandList className="max-h-64 min-h-0 flex-1">
              <CommandEmpty>
                {loading
                  ? t("loading")
                  : searchError
                    ? t("couldNotLoadDegrees")
                    : t("typeToSearchDegrees")}
              </CommandEmpty>
              <CommandGroup>
                {options.map((degree) => (
                  <CommandItem
                    key={degree.id}
                    value={String(degree.id)}
                    onPointerDown={(event) => {
                      if (inDialog) event.preventDefault();
                    }}
                    onSelect={() => select(degree)}
                  >
                    <CheckIcon
                      aria-hidden="true"
                      className={cn(
                        "size-4",
                        String(degree.id) === value ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="min-w-0 whitespace-normal wrap-anywhere">{degree.name}</span>
                  </CommandItem>
                ))}
                {canPropose && (
                  <CommandItem value={`propose-${query}`} onSelect={() => void propose()}>
                    <PlusIcon aria-hidden="true" className="size-4" />
                    {t("addQuotedInline", { query: query.trim() })}
                  </CommandItem>
                )}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
