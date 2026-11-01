"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { ShortcutKbd } from "@/components/common/shortcut-hint";
import { useNavVisibility } from "@/components/layout/app-sidebar";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useLocale } from "@/lib/i18n";
import { visibleNavGroups, visibleSubDestinations } from "@/lib/nav";
import {
  focusListSearch,
  HINTED_SHORTCUTS,
  isApplePlatform,
  SHORTCUTS,
  setCommandPaletteOpen,
  shouldHandleShortcut,
  toggleCommandPalette,
  triggerShortcutSave,
  useCommandPaletteOpen,
} from "@/lib/shortcuts";

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

/**
 * Title-first ranking (#1182): cmdk's default fuzzy match scatters letters
 * across the href and group labels, so "stats" matched unrelated pages and
 * outranked the real one. Keywords[0] is always the item title.
 */
export function rankDestination(_value: string, search: string, keywords: string[] = []): number {
  const query = normalize(search);
  if (!query) return 1;
  const [title = "", ...rest] = keywords.map(normalize);
  if (title.startsWith(query)) return 1;
  if (title.split(/[\s›/-]+/).some((word) => word.startsWith(query))) return 0.9;
  if (title.includes(query)) return 0.7;
  if (rest.some((keyword) => keyword.includes(query))) return 0.4;
  return 0;
}

/**
 * Global keyboard shortcuts (#1182, docs/DESIGN.md §9) and the quick-search
 * palette over the caller's sidebar destinations. Mounted once by AppShell.
 */
export function CommandPalette() {
  const open = useCommandPaletteOpen();
  const { t } = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const isVisible = useNavVisibility();

  useEffect(() => {
    const isApple = isApplePlatform(navigator);
    function onKeyDown(event: KeyboardEvent) {
      if (shouldHandleShortcut(event, SHORTCUTS.commandPalette, isApple)) {
        event.preventDefault();
        toggleCommandPalette();
      } else if (shouldHandleShortcut(event, SHORTCUTS.save, isApple)) {
        if (triggerShortcutSave(document)) event.preventDefault();
      } else if (shouldHandleShortcut(event, SHORTCUTS.focusSearch, isApple)) {
        if (focusListSearch(document)) event.preventDefault();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      setCommandPaletteOpen(false);
    };
  }, []);

  const subDestinations = open ? visibleSubDestinations(isVisible) : [];

  function go(href: string) {
    setCommandPaletteOpen(false);
    if (href !== pathname) router.push(href);
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={setCommandPaletteOpen}
      title={t("quickSearch")}
      description={t("quickSearchPlaceholder")}
      showCloseButton={false}
      filter={rankDestination}
      className="top-[18%] translate-y-0"
    >
      <CommandInput placeholder={t("quickSearchPlaceholder")} />
      <CommandList className="max-h-[min(24rem,55vh)]">
        <CommandEmpty>{t("noResultsLabel")}</CommandEmpty>
        {open &&
          visibleNavGroups(isVisible).map((group) => (
            <CommandGroup key={group.id} heading={t(group.label)}>
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <CommandItem
                    key={item.href}
                    value={item.href}
                    keywords={[t(item.title), t(group.label)]}
                    onSelect={() => go(item.href)}
                  >
                    <Icon aria-hidden="true" />
                    {t(item.title)}
                  </CommandItem>
                );
              })}
              {subDestinations
                .filter((entry) => entry.groupId === group.id)
                .map(({ item, parent }) => {
                  const Icon = item.icon;
                  return (
                    <CommandItem
                      key={item.href}
                      value={item.href}
                      keywords={[
                        t(item.title),
                        t(item.via ?? parent.title),
                        t(parent.title),
                        t(group.label),
                      ]}
                      onSelect={() => go(item.href)}
                    >
                      <Icon aria-hidden="true" />
                      {t(item.title)}
                      <span className="ml-auto truncate text-xs text-muted-foreground">
                        {item.via ? `${t(parent.title)} › ${t(item.via)}` : t(parent.title)}
                      </span>
                    </CommandItem>
                  );
                })}
            </CommandGroup>
          ))}
      </CommandList>
      <ul
        aria-label={t("keyboardShortcuts")}
        className="flex flex-wrap gap-x-4 gap-y-1 border-t px-3 py-2 text-xs text-muted-foreground"
      >
        {HINTED_SHORTCUTS.map((id) => (
          <li key={id} className="flex items-center gap-1.5">
            <ShortcutKbd shortcut={id} />
            {t(SHORTCUTS[id].label)}
          </li>
        ))}
      </ul>
    </CommandDialog>
  );
}
