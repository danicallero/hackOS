"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
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
import { visibleNavGroups } from "@/lib/nav";
import {
  focusListSearch,
  formatShortcut,
  HINTED_SHORTCUTS,
  isApplePlatform,
  SHORTCUTS,
  setCommandPaletteOpen,
  shouldHandleShortcut,
  toggleCommandPalette,
  triggerShortcutSave,
  useCommandPaletteOpen,
  useIsApplePlatform,
} from "@/lib/shortcuts";

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
  const apple = useIsApplePlatform();

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
            </CommandGroup>
          ))}
      </CommandList>
      <ul
        aria-label={t("keyboardShortcuts")}
        className="flex flex-wrap gap-x-4 gap-y-1 border-t px-3 py-2 text-xs text-muted-foreground"
      >
        {HINTED_SHORTCUTS.map((id) => (
          <li key={id} className="flex items-center gap-1.5">
            <kbd className="rounded-sm border bg-muted px-1.5 font-sans text-[11px] font-medium text-foreground">
              {formatShortcut(SHORTCUTS[id], apple)}
            </kbd>
            {t(SHORTCUTS[id].label)}
          </li>
        ))}
      </ul>
    </CommandDialog>
  );
}
