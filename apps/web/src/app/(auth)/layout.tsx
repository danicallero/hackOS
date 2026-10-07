"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Brand } from "@/components/common/brand";
import { LanguageSelect } from "@/components/common/language-select";
import { ThemeToggle } from "@/components/common/theme-toggle";
import { useLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Shell for unauthenticated flows (H1-H5): centered card on a plain canvas,
 * brand top-left, theme toggle top-right. Every auth screen renders inside it.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const { t } = useLocale();
  const confirmation = usePathname() === "/applications/confirm";
  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden">
      <header className="flex items-center justify-between px-6 py-4">
        <Link href="/">
          <Brand />
        </Link>
        <div className="flex items-center gap-1">
          <LanguageSelect />
          <ThemeToggle />
        </div>
      </header>
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className={cn("w-full", confirmation ? "max-w-3xl" : "max-w-md")}>{children}</div>
      </main>
      <footer className="text-muted-foreground px-6 py-4 text-center text-xs">
        <nav
          aria-label={t("legalLinksLabel")}
          className="flex flex-wrap justify-center gap-x-4 gap-y-2"
        >
          <Link className="underline underline-offset-4 hover:text-foreground" href="/terms">
            {t("termsAndConditions")}
          </Link>
          <Link className="underline underline-offset-4 hover:text-foreground" href="/privacy">
            {t("privacyPolicy")}
          </Link>
        </nav>
      </footer>
    </div>
  );
}
