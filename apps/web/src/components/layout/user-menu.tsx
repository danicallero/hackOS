"use client";

import { MonitorIcon } from "@phosphor-icons/react/dist/csr/Monitor";
import { MoonIcon } from "@phosphor-icons/react/dist/csr/Moon";
import { SignOutIcon } from "@phosphor-icons/react/dist/csr/SignOut";
import { SunIcon } from "@phosphor-icons/react/dist/csr/Sun";
import { TranslateIcon } from "@phosphor-icons/react/dist/csr/Translate";
import { UserIcon } from "@phosphor-icons/react/dist/csr/User";
import Link from "next/link";
import { useTheme } from "next-themes";
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
import { signOut } from "@/lib/auth-client";
import { languageName, useLocale } from "@/lib/i18n";
import { useSessionContext } from "@/lib/session";
import type { Language } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Avatar dropdown: identity summary + sign out (H4). */
export function UserMenu({ className }: { className?: string }) {
  const { me, refresh } = useSessionContext();
  const { language, setLanguage, t } = useLocale();
  const { setTheme, theme } = useTheme();
  const { state: sidebarState } = useSidebar();
  if (!me) return null;

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
          className={cn(
            "h-auto min-h-[var(--control-height-default)] flex-1 justify-start gap-2 px-2 py-1 text-left group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0!",
            className,
          )}
        >
          <UserIcon
            aria-hidden="true"
            className="hidden size-4 group-data-[collapsible=icon]:block"
          />
          <span className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
            <span className="block truncate text-sm font-medium">{me.name ?? me.email}</span>
            <span className="text-muted-foreground block truncate text-xs">{me.email}</span>
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="ml-2 w-56">
        <DropdownMenuLabel className="flex flex-col">
          <span className="truncate">
            {me.name} {me.surname}
          </span>
          <span className="text-muted-foreground truncate text-xs font-normal">{me.email}</span>
          <span className="text-muted-foreground mt-1 text-xs font-normal capitalize">
            {me.visibleRoleName}
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
