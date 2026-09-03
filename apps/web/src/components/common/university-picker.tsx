"use client";

// University autocomplete for the "university" application field kind (H12).
// Searches the public directory (GET /api/public/universities?q=) and lets an
// applicant propose a missing one (POST /api/public/universities/propose). The
// stored value is the university id as a string, keyed by the field in the
// response object; only the id is persisted, never a free-text name.

import { CheckIcon, ChevronsUpDownIcon, PlusIcon } from "lucide-react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { useEffect, useId, useState } from "react";
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
  /** Shows the "add <query>" option for authenticated users when no exact match exists. */
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
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<University[]>([]);
  // Starts true: a search always kicks off on mount.
  const [loading, setLoading] = useState(true);
  const [searchError, setSearchError] = useState(false);
  const [searchAttempt, setSearchAttempt] = useState(0);
  const [proposing, setProposing] = useState(false);
  // The id/name pair last resolved via the by-id lookup below (a preset value
  // not present in the current search page, e.g. a reloaded draft) — kept
  // alongside its id so a stale label can't outlive a `value` change.
  const [resolvedLabel, setResolvedLabel] = useState<{ id: string; name: string } | null>(null);

  // "loading"/"searchError" reset here, on the actions that start a new
  // search, rather than at the top of the effect below — that effect only
  // fires the debounced request itself.
  function handleQueryChange(next: string) {
    setQuery(next);
    setLoading(true);
    setSearchError(false);
  }
  function retrySearch() {
    setSearchAttempt((attempt) => attempt + 1);
    setLoading(true);
    setSearchError(false);
  }

  // Debounced search against the public directory.
  // biome-ignore lint/correctness/useExhaustiveDependencies: searchAttempt intentionally retries the unchanged query.
  useEffect(() => {
    let active = true;
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

  const knownLabel = value ? (options.find((o) => String(o.id) === value)?.name ?? null) : null;

  // Resolves the label for a preset value not in the current search page
  // (draft reload). `knownLabel`/the `resolvedLabel.id === value` check below
  // mean a `value` change clears the stale label without this effect having
  // to do it itself.
  useEffect(() => {
    if (!value || knownLabel || resolvedLabel?.id === value) return;
    let active = true;
    api
      .get<{ universities: University[] }>("/api/public/universities", {
        query: { ids: value },
      })
      .then(({ universities }) => {
        const match = universities.find((o) => String(o.id) === value);
        if (active && match) setResolvedLabel({ id: value, name: match.name });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [value, knownLabel, resolvedLabel]);

  function select(u: University) {
    onChange(String(u.id));
    setResolvedLabel({ id: String(u.id), name: u.name });
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
  const asyncLabel = resolvedLabel?.id === value ? resolvedLabel.name : null;
  const label = value
    ? (knownLabel ?? asyncLabel ?? t("universityNumberFallback", { id: value }))
    : null;

  const content = (
    <PopoverPrimitive.Content
      align="start"
      sideOffset={4}
      collisionPadding={8}
      {...contentProps}
      id={listboxId}
      className="bg-popover text-popover-foreground z-50 flex max-h-(--radix-popover-content-available-height) w-(--radix-popover-trigger-width) flex-col rounded-md border shadow-md outline-hidden"
    >
      <Command shouldFilter={false}>
        <CommandInput
          placeholder={t("searchUniversitiesShortPlaceholder")}
          value={query}
          onValueChange={handleQueryChange}
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
              <Button type="button" size="sm" variant="outline" onClick={retrySearch}>
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
          aria-controls={listboxId}
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-labelledby={ariaLabelledBy}
          aria-describedby={ariaDescribedBy}
          aria-invalid={ariaInvalid}
          aria-required={ariaRequired}
          className={cn("w-full justify-between font-normal", className)}
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
