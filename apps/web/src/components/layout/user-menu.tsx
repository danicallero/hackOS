"use client";

import { LogOutIcon, UserIcon } from "lucide-react";
import Link from "next/link";
import { initials } from "@/app/(app)/users/[id]/shared";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOut } from "@/lib/auth-client";
import { useLocale } from "@/lib/i18n";
import { useSessionContext } from "@/lib/session";

/** Avatar dropdown: identity summary + sign out (H4). */
export function UserMenu() {
  const { me, refresh } = useSessionContext();
  const { t } = useLocale();
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
        <Button variant="ghost" size="sm" className="gap-2 px-2">
          <Avatar className="size-7">
            {me.image && <AvatarImage src={me.image} alt="" />}
            <AvatarFallback className="text-xs">{initials(me)}</AvatarFallback>
          </Avatar>
          <span className="hidden max-w-32 truncate text-sm sm:inline">{me.name ?? me.email}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
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
            <UserIcon className="size-4" /> {t("profile")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={handleSignOut}>
          <LogOutIcon className="size-4" /> {t("signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
