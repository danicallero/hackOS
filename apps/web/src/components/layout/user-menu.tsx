"use client";

import { shouldShowEditionSelector } from "@hackos/shared/editions";
import { CalendarDotsIcon } from "@phosphor-icons/react/dist/csr/CalendarDots";
import { MonitorIcon } from "@phosphor-icons/react/dist/csr/Monitor";
import { MoonIcon } from "@phosphor-icons/react/dist/csr/Moon";
import { SignOutIcon } from "@phosphor-icons/react/dist/csr/SignOut";
import { SunIcon } from "@phosphor-icons/react/dist/csr/Sun";
import { TranslateIcon } from "@phosphor-icons/react/dist/csr/Translate";
import { UserIcon } from "@phosphor-icons/react/dist/csr/User";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { UserAvatar } from "@/components/common/user-avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSidebar } from "@/components/ui/sidebar";
import { useEditions, useViewedEditionKey } from "@/hooks/use-editions";
import { signOut } from "@/lib/auth-client";
import { languageName, useLocale } from "@/lib/i18n";
import { useSessionContext } from "@/lib/session";
import type { Language } from "@/lib/types";
import { cn } from "@/lib/utils";
import { setViewedEdition } from "@/lib/viewed-edition";

/** Avatar dropdown: identity summary + sign out (H4). */
export function UserMenu({ className }: { className?: string }) {
  const router = useRouter();
  const { me, refresh } = useSessionContext();
  const { language, setLanguage, t } = useLocale();
  const { setTheme, theme } = useTheme();
  const { state: sidebarState } = useSidebar();
  const { editions, current: currentKey } = useEditions();
  const viewedKey = useViewedEditionKey();
  if (!me) return null;
  const displayName = [me.name, me.surname].filter(Boolean).join(" ") || me.email;

  async function handleSignOut() {
    await signOut();
    // AuthGuard owns the route transition once the session becomes
    // unauthenticated. Issuing another push here races that replacement.
    await refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={me.name ? `${me.name} ${me.email}` : me.email}
          className={cn(
            "h-auto min-h-[var(--control-height-default)] flex-1 justify-start gap-2 px-2 py-1 text-left group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0!",
            className,
          )}
        >
          {me.image ? (
            <UserAvatar
              decorative
              name={displayName}
              image={me.image}
              className="size-7 group-data-[collapsible=icon]:size-6"
            />
          ) : (
            <UserIcon
              aria-hidden="true"
              className="hidden size-4 group-data-[collapsible=icon]:block"
            />
          )}
          <span className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
            <span className="block truncate text-sm font-medium">{me.name || me.email}</span>
            {me.name && (
              <>
                {" "}
                <span className="text-muted-foreground block truncate text-xs">{me.email}</span>
              </>
            )}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="ml-2 w-56">
        <DropdownMenuLabel className="flex items-center gap-3">
          {me.image ? (
            <UserAvatar decorative name={displayName} image={me.image} className="size-10" />
          ) : null}
          <span className="flex min-w-0 flex-col">
            <span className="truncate">{displayName}</span>
            <span className="text-muted-foreground truncate text-xs font-normal">{me.email}</span>
            <span className="text-muted-foreground mt-1 text-xs font-normal capitalize">
              {me.visibleRoleName}
            </span>
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings/profile">
            <UserIcon aria-hidden="true" className="size-4" /> {t("profile")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <TranslateIcon aria-hidden="true" className="size-4" /> {t("language")}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup
              value={language}
              onValueChange={(value) => setLanguage(value as Language)}
            >
              {(["es", "gl", "en"] as const).map((item) => (
                <DropdownMenuRadioItem key={item} value={item}>
                  {languageName(item)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {shouldShowEditionSelector(editions) && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <CalendarDotsIcon aria-hidden="true" className="size-4" /> {t("edition")}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup
                value={viewedKey ?? currentKey ?? ""}
                onValueChange={(value) => {
                  setViewedEdition(value === currentKey ? null : value);
                  // Server-rendered pages (the gallery) read the edition cookie.
                  router.refresh();
                }}
              >
                {editions.map((edition) => (
                  <DropdownMenuRadioItem key={edition.eventKey} value={edition.eventKey}>
                    {edition.name}
                    {edition.isCurrent && (
                      <span className="text-muted-foreground ml-auto pl-3 text-xs">
                        {t("editionCurrent")}
                      </span>
                    )}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
        {sidebarState === "collapsed" && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              {theme === "dark" ? (
                <MoonIcon aria-hidden="true" className="size-4" />
              ) : theme === "light" ? (
                <SunIcon aria-hidden="true" className="size-4" />
              ) : (
                <MonitorIcon aria-hidden="true" className="size-4" />
              )}
              {t("toggleTheme")}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem onClick={() => setTheme("light")}>
                <SunIcon aria-hidden="true" className="size-4" /> {t("light")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("dark")}>
                <MoonIcon aria-hidden="true" className="size-4" /> {t("dark")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("system")}>
                <MonitorIcon aria-hidden="true" className="size-4" /> {t("system")}
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={handleSignOut}>
          <SignOutIcon aria-hidden="true" className="size-4" /> {t("signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
