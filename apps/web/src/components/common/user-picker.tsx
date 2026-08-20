"use client";

// Generic type-ahead user combobox: type a name/email, pick from a dropdown.
// Mirrors UniversityPicker's pattern (Command + Popover) but is backend-agnostic
// — callers supply the search function so this works against /api/users,
// /api/projects/member-candidates, or any other user-search endpoint.

import { CheckIcon, ChevronsUpDownIcon } from "lucide-react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { useEffect, useRef, useState } from "react";
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
  id?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
}) {
  const { t } = useLocale();
  const { ref: anchorRef, portalProps, contentProps } = useDialogPortal(inDialog);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<UserOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [selected, setSelected] = useState<UserOption | null>(null);

  // `search` is almost always a fresh closure every render (callers rarely
  // memoize it) — reading it via a ref, rather than depending on it
  // directly, keeps a re-render mid-type from restarting the debounce timer
  // before it ever fires, which otherwise gets the search permanently stuck
  // on "Searching…" if the caller re-renders more often than the debounce.
  const searchRef = useRef(search);
  searchRef.current = search;

  useEffect(() => {
    if (!open || query.trim().length < minQueryLength) {
      setOptions([]);
      return;
    }
    let active = true;
    setLoading(true);
    setSearchError(false);
    const handle = setTimeout(async () => {
      try {
        const users = await searchRef.current(query.trim());
        if (active) setOptions(users);
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
  }, [open, query, minQueryLength]);

  useEffect(() => {
    if (!value) setSelected(null);
  }, [value]);

  function select(user: UserOption) {
    setSelected(user);
    onChange(String(user.id), user);
    setOpen(false);
  }

  const label = selected ? userOptionLabel(selected) : null;

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
          ) : options.length === 0 ? (
            <CommandEmpty>{t("noMatchingUsersPeriod")}</CommandEmpty>
          ) : null}
          <CommandGroup>
            {options.map((user) => (
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
          className={cn("h-auto min-h-10 w-full justify-between px-3 py-2 font-normal", className)}
        >
          <span className={cn("flex-1 truncate text-left", !label && "text-muted-foreground")}>
            {label ?? placeholder ?? t("selectUserPlaceholder")}
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
