"use client";

// University autocomplete for the "university" application field kind (H12).
// Searches the public directory (GET /api/public/universities?q=) and lets an
// applicant propose a missing one (POST /api/public/universities/propose). The
// stored value is the university id as a string, keyed by the field in the
// response object; only the id is persisted, never a free-text name.

import { CheckIcon, ChevronsUpDownIcon, PlusIcon } from "lucide-react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
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
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { useSessionContext } from "@/lib/session";
import { cn } from "@/lib/utils";

interface University {
  id: number;
  name: string;
}

export function UniversityPicker({
  value,
  onChange,
  disabled,
  inDialog = false,
  className,
  allowPropose = true,
  id,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  "aria-required": ariaRequired,
}: {
  /** Selected university id as a string, or "" when unset. */
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  inDialog?: boolean;
  className?: string;
  allowPropose?: boolean;
  id?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: React.AriaAttributes["aria-invalid"];
  "aria-required"?: React.AriaAttributes["aria-required"];
}) {
  const { t } = useLocale();
  const { ref: anchorRef, portalProps, contentProps } = useDialogPortal(inDialog);
  const { status } = useSessionContext();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<University[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [searchAttempt, setSearchAttempt] = useState(0);
  const [proposing, setProposing] = useState(false);
  // Remember the label for the currently-selected id so it renders even when
  // that id isn't in the latest search page (e.g. a reloaded draft).
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);

  // Debounced search against the public directory.
  // biome-ignore lint/correctness/useExhaustiveDependencies: searchAttempt intentionally retries the unchanged query.
  useEffect(() => {
    let active = true;
    setLoading(true);
    setSearchError(false);
    const handle = setTimeout(async () => {
      try {
        const { universities } = await api.get<{ universities: University[] }>(
          "/api/public/universities",
          { query: { q: query.trim() || undefined } },
        );
        if (active) setOptions(universities);
      } catch {
        if (active) {
          setOptions([]);
          setSearchError(true);
        }
      } finally {
        if (active) setLoading(false);
      }
    }, 200);
    return () => {
      active = false;
      clearTimeout(handle);
    };
  }, [query, searchAttempt]);

  // Resolve the label for a preset value on mount (draft reload).
  const resolvedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!value) {
      setSelectedLabel(null);
      resolvedFor.current = null;
      return;
    }
    const known = options.find((o) => String(o.id) === value);
    if (known) {
      setSelectedLabel(known.name);
      resolvedFor.current = value;
    } else if (resolvedFor.current !== value) {
      resolvedFor.current = value;
      api
        .get<{ universities: University[] }>("/api/public/universities", {
          query: { ids: value },
        })
        .then(({ universities }) => {
          const match = universities.find((o) => String(o.id) === value);
          if (match) setSelectedLabel(match.name);
        })
        .catch(() => {});
    }
  }, [value, options]);

  function select(u: University) {
    onChange(String(u.id));
    setSelectedLabel(u.name);
    setOpen(false);
  }

  async function propose() {
    const name = query.trim();
    if (!name || status !== "authenticated") return;
    setProposing(true);
    try {
      const created = await api.post<University>("/api/public/universities/propose", { name });
      toast.success(t("addedUniversityInline", { name: created.name }));
      select(created);
      setQuery("");
    } catch (err) {
      // The session can expire after this authenticated-only action becomes
      // available. Point back to sign-in rather than presenting it as a
      // catalogue-validation failure.
      toast.error(
        err instanceof ApiError && err.status === 401
          ? t("signIn")
          : err instanceof ApiError
            ? err.message
            : t("couldNotAddUniversity"),
      );
    } finally {
      setProposing(false);
    }
  }

  const exactMatch = options.some((o) => o.name.toLowerCase() === query.trim().toLowerCase());
  const canPropose =
    allowPropose &&
    status === "authenticated" &&
    !searchError &&
    query.trim().length > 1 &&
    !exactMatch &&
    !loading;
  const label = value ? (selectedLabel ?? t("universityNumberFallback", { id: value })) : null;

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
          placeholder={t("searchUniversitiesShortPlaceholder")}
          value={query}
          onValueChange={setQuery}
        />
        <CommandList aria-busy={loading || undefined} className="max-h-64 min-h-0 flex-1">
          {loading ? (
            <div role="status" className="text-muted-foreground px-2 py-6 text-center text-sm">
              {t("loading")}
            </div>
          ) : searchError ? (
            <div
              role="alert"
              className="text-destructive flex flex-col items-center gap-2 px-2 py-6 text-center text-sm"
            >
              {t("couldNotLoadUniversities")}
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setSearchAttempt((attempt) => attempt + 1)}
              >
                {t("retry")}
              </Button>
            </div>
          ) : options.length === 0 && !canPropose ? (
            <CommandEmpty>{t("typeToSearchUniversities")}</CommandEmpty>
          ) : null}
          <CommandGroup>
            {options.map((u) => (
              <CommandItem key={u.id} value={String(u.id)} onSelect={() => select(u)}>
                <CheckIcon
                  aria-hidden="true"
                  className={cn("size-4", String(u.id) === value ? "opacity-100" : "opacity-0")}
                />
                {u.name}
              </CommandItem>
            ))}
            {canPropose && (
              <CommandItem value={`propose-${query}`} onSelect={propose} disabled={proposing}>
                <PlusIcon aria-hidden="true" className="size-4" />
                {t("addQuotedInline", { query: query.trim() })}
              </CommandItem>
            )}
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
          aria-invalid={ariaInvalid}
          aria-required={ariaRequired}
          className={cn("h-auto min-h-10 w-full justify-between px-3 py-2 font-normal", className)}
        >
          <span className={cn("flex-1 truncate text-left", !label && "text-muted-foreground")}>
            {label ?? t("selectYourUniversityPlaceholder")}
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
