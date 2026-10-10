"use client";

// Generic type-ahead user combobox: type a name/email, pick from a dropdown.
// Mirrors UniversityPicker's pattern (Command + Popover) but is backend-agnostic
// — callers supply the search function so this works against /api/users,
// /api/projects/member-candidates, or any other user-search endpoint.

import { CaretUpDownIcon } from "@phosphor-icons/react/dist/csr/CaretUpDown";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { Popover as PopoverPrimitive } from "radix-ui";
import { useCallback, useEffect, useId, useRef, useState } from "react";
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

export interface UserOption {
  id: number;
  email: string;
  name: string | null;
  surname: string | null;
}

export function userOptionLabel(user: UserOption): string {
  const name = [user.name, user.surname].filter(Boolean).join(" ").trim();
  return name ? `${name} · ${user.email}` : user.email;
}

export function UserPicker({
  value,
  onChange,
  search,
  disabled,
  inDialog = false,
  className,
  placeholder,
  minQueryLength = 0,
  initialQuery,
  autoSelect,
  id,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
}: {
  /** Selected user id as a string, or "" when unset. */
  value: string;
  onChange: (value: string, user: UserOption | null) => void;
  /** Resolves the dropdown options for a (possibly empty) query. */
  search: (query: string) => Promise<UserOption[]>;
  disabled?: boolean;
  inDialog?: boolean;
  className?: string;
  placeholder?: string;
  /** Query length below which `search` isn't called at all. */
  minQueryLength?: number;
  /** Query populated when the picker opens, for contextual suggestions. */
  initialQuery?: string;
  /** Returns a safe initial selection from the contextual suggestions, if any. */
  autoSelect?: (users: UserOption[]) => UserOption | null;
  id?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
}) {
  const { t } = useLocale();
  const { ref: anchorRef, portalProps, contentProps } = useDialogPortal(inDialog);
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<UserOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [selected, setSelected] = useState<UserOption | null>(null);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const suggestionQueryRef = useRef<string | null>(null);
  const autoSelectionAttemptedRef = useRef(false);

  const select = useCallback((user: UserOption, close = true) => {
    valueRef.current = String(user.id);
    setSelected(user);
    onChangeRef.current(String(user.id), user);
    if (close) setOpen(false);
  }, []);

  // `search` is a fresh closure most renders (callers rarely memoize it); reading
  // it via a ref instead of depending on it directly stops a mid-type re-render
  // from restarting the debounce before it fires, which would otherwise stick
  // the search on "Searching…" forever.
  const searchRef = useRef(search);
  useEffect(() => {
    searchRef.current = search;
  });

  useEffect(() => {
    onChangeRef.current = onChange;
  });

  // `autoSelect` is commonly an inline identity matcher. Keep its latest
  // implementation without turning an in-flight query into a new request.
  const autoSelectRef = useRef(autoSelect);
  useEffect(() => {
    autoSelectRef.current = autoSelect;
  });

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    if (!open || query.trim().length < minQueryLength) return;
    let active = true;
    const requestedQuery = query.trim();
    const handle = setTimeout(async () => {
      setLoading(true);
      setSearchError(false);
      try {
        const users = await searchRef.current(requestedQuery);
        if (!active) return;
        setOptions(users);

        // Only the response for the query supplied at open time can offer an
        // automatic selection. A manual choice wins immediately, even if this
        // request resolves afterwards.
        if (
          !autoSelectionAttemptedRef.current &&
          !valueRef.current &&
          requestedQuery === suggestionQueryRef.current
        ) {
          autoSelectionAttemptedRef.current = true;
          const suggested = autoSelectRef.current?.(users);
          if (suggested && users.some((user) => user.id === suggested.id)) select(suggested, false);
        }
      } catch {
        if (active) {
          setOptions([]);
          setSearchError(true);
        }
      } finally {
        if (active) setLoading(false);
      }
    }, 250);
    return () => {
      active = false;
      clearTimeout(handle);
    };
  }, [open, query, minQueryLength, select]);

  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    if (!value) setSelected(null);
  }

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen && initialQuery !== undefined) {
      const suggestedQuery = initialQuery.trim();
      suggestionQueryRef.current = suggestedQuery;
      autoSelectionAttemptedRef.current = Boolean(valueRef.current);
      setQuery(suggestedQuery);
    } else if (!nextOpen) {
      suggestionQueryRef.current = null;
    }
    setOpen(nextOpen);
  }

  const label = selected ? userOptionLabel(selected) : null;
  const visibleOptions = query.trim().length < minQueryLength ? [] : options;

  const content = (
    <PopoverPrimitive.Content
      align="start"
      sideOffset={4}
      collisionPadding={8}
      {...contentProps}
      id={listboxId}
      className="pointer-events-auto bg-popover text-popover-foreground z-50 flex max-h-(--radix-popover-content-available-height) w-(--radix-popover-trigger-width) flex-col rounded-md border shadow-md outline-hidden"
    >
      <Command shouldFilter={false}>
        <CommandInput
          placeholder={t("searchUsersNameEmailPlaceholder")}
          value={query}
          onValueChange={setQuery}
        />
        <CommandList aria-busy={loading || undefined} className="max-h-64 min-h-0 flex-1">
          {loading ? (
            <div role="status" className="text-muted-foreground px-2 py-6 text-center text-sm">
              {t("searchingEllipsis")}
            </div>
          ) : searchError ? (
            <div role="alert" className="text-destructive px-2 py-6 text-center text-sm">
              {t("couldNotSearchUsers")}
            </div>
          ) : query.trim().length < minQueryLength ? (
            <CommandEmpty>{t("typeToSearchUsers")}</CommandEmpty>
          ) : visibleOptions.length === 0 ? (
            <CommandEmpty>{t("noMatchingUsersPeriod")}</CommandEmpty>
          ) : null}
          <CommandGroup>
            {visibleOptions.map((user) => (
              <CommandItem key={user.id} value={String(user.id)} onSelect={() => select(user)}>
                <CheckIcon
                  aria-hidden="true"
                  className={cn("size-4", String(user.id) === value ? "opacity-100" : "opacity-0")}
                />
                {userOptionLabel(user)}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </PopoverPrimitive.Content>
  );

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={handleOpenChange}>
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
          className={cn("w-full justify-between rounded-control font-normal", className)}
        >
          <span className={cn("flex-1 truncate text-left", !label && "text-muted-foreground")}>
            {label ?? placeholder ?? t("selectUserPlaceholder")}
          </span>
          <CaretUpDownIcon aria-hidden="true" className="text-muted-foreground size-4 shrink-0" />
        </Button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal {...portalProps}>{content}</PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
