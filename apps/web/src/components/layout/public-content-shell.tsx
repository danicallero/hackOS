"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Brand } from "@/components/common/brand";
import { LanguageSelect } from "@/components/common/language-select";
import { Spinner } from "@/components/common/spinner";
import { ThemeToggle } from "@/components/common/theme-toggle";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n";
import { withReturnPath } from "@/lib/return-path";
import { useSessionContext } from "@/lib/session";

/** H18/H45: public records retain the app shell for signed-in viewers. */
export function PublicContentShell({ children }: { children: React.ReactNode }) {
  const { status } = useSessionContext();
  const { t } = useLocale();
  const pathname = usePathname();
  const publicRecord =
    pathname === "/gallery" ||
    pathname.startsWith("/gallery/") ||
    pathname.startsWith("/challenge/");
  if (status === "authenticated" || !publicRecord) return <AppShell>{children}</AppShell>;
  if (status === "loading")
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner className="size-6" />
      </div>
    );
  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6">
      <header className="flex items-center justify-between gap-2 py-5 sm:py-6">
        <Brand />
        <div className="flex items-center gap-2">
          <LanguageSelect />
          <ThemeToggle />
          <Button size="sm" asChild>
            <Link href={withReturnPath("/login", pathname)}>{t("logIn")}</Link>
          </Button>
        </div>
      </header>
      <main className="py-6 lg:py-8">{children}</main>
    </div>
  );
}
