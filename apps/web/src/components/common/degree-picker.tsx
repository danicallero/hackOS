"use client";

// Curated degree autocomplete. It mirrors the university directory's proposal
// limits on the API and stores only the stable catalogue id in a response.
import { CheckIcon, ChevronsUpDownIcon, PlusIcon } from "lucide-react";
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
import { useDialogPortal } from "@/hooks/use-dialog-portal";
import { api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
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
  const [options, setOptions] = useState<Degree[]>([]);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      api
        .get<{ degrees: Degree[] }>("/api/public/degrees", {
          query: { q: query.trim() || undefined },
        })
        .then((result) => active && setOptions(result.degrees))
        .catch(() => active && setOptions([]))
        .finally(() => active && setLoading(false));
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query]);
  useEffect(() => {
    if (!value || options.some((item) => String(item.id) === value) || label) return;
    api
      .get<{ degrees: Degree[] }>("/api/public/degrees", { query: { ids: value } })
      .then(({ degrees }) => setLabel(degrees[0]?.name ?? null))
      .catch(() => {});
  }, [value, options, label]);
  const select = (degree: Degree) => {
    onChange(String(degree.id));
    setLabel(degree.name);
    setQuery("");
    setOpen(false);
    onBlur?.();
  };
  const propose = async () => {
    const name = query.trim();
    if (!name || status !== "authenticated") return;
    const degree = await api.post<Degree>("/api/public/degrees/propose", { name });
    toast.success(t("degreeAdded"));
    select(degree);
  };
  const currentLabel = options.find((item) => String(item.id) === value)?.name ?? label;
  const canPropose =
    status === "authenticated" &&
    query.trim().length > 1 &&
    !loading &&
    !options.some((item) => item.name.toLowerCase() === query.trim().toLowerCase());
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
          role="combobox"
          aria-controls={listboxId}
          aria-expanded={open}
          aria-haspopup="listbox"
          {...aria}
          className="w-full justify-between font-normal"
        >
          <span className="truncate">{currentLabel ?? t("selectDegreePlaceholder")}</span>
          <ChevronsUpDownIcon className="text-muted-foreground size-4 shrink-0" />
        </Button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal {...portalProps}>
        <PopoverPrimitive.Content
          {...contentProps}
          id={listboxId}
          align="start"
          sideOffset={4}
          className="bg-popover text-popover-foreground z-50 w-(--radix-popover-trigger-width) rounded-md border shadow-md"
        >
          <Command shouldFilter={false}>
            <CommandInput
              placeholder={t("searchDegreesPlaceholder")}
              value={query}
              onValueChange={(next) => {
                setQuery(next);
                setLoading(true);
              }}
            />
            <CommandList className="max-h-64">
              <CommandEmpty>{loading ? t("loading") : t("typeToSearchDegrees")}</CommandEmpty>
              <CommandGroup>
                {options.map((degree) => (
                  <CommandItem
                    key={degree.id}
                    value={String(degree.id)}
                    onSelect={() => select(degree)}
                  >
                    <CheckIcon
                      className={cn(
                        "size-4",
                        String(degree.id) === value ? "opacity-100" : "opacity-0",
                      )}
                    />
                    {degree.name}
                  </CommandItem>
                ))}
                {canPropose && (
                  <CommandItem value={`propose-${query}`} onSelect={() => void propose()}>
                    <PlusIcon className="size-4" />
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
