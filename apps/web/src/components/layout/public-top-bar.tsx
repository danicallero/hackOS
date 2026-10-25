"use client";

import { ArrowRightIcon } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { SignInIcon } from "@phosphor-icons/react/dist/csr/SignIn";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { Brand } from "@/components/common/brand";
import { LanguageSelect } from "@/components/common/language-select";
import { ThemeToggle } from "@/components/common/theme-toggle";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n";
import { withReturnPath } from "@/lib/return-path";
import { useSessionContext } from "@/lib/session";
import { cn } from "@/lib/utils";

// Module state: the first run is the initial load and a popstate is back/forward,
// both of which keep the browser's own scroll restoration.
let loaded = false;
let popped = false;
if (typeof window !== "undefined") window.addEventListener("popstate", () => (popped = true));

/**
 * The one top bar of every public surface (landing, schedule, gallery, legal,
 * certificate verification, auth). Sticky, hackOS wordmark at the leading edge
 * linking home, language + theme and the session entry point at the trailing
 * edge. Pages never title themselves here: the event name belongs in content.
 */
export function PublicTopBar({
  access = true,
  className,
}: {
  /** Hide the log-in / go-to-app button, e.g. on the sign-in screens themselves. */
  access?: boolean;
  className?: string;
}) {
  const { t } = useLocale();
  const { status } = useSessionContext();
  const pathname = usePathname();
  // Next keeps the scroll position when the first element of the new page (this
  // sticky bar) is already in view, so a footer link would open the next page
  // at the bottom. Reset on forward navigation; back/forward keep their restore.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per route change.
  useEffect(() => {
    if (!loaded) loaded = true;
    else if (popped) popped = false;
    else if (!window.location.hash) window.scrollTo(0, 0);
  }, [pathname]);
  return (
    <header
      className={cn(
        "bg-background/90 sticky top-0 z-40 shrink-0 border-b backdrop-blur supports-[backdrop-filter]:bg-background/80",
        className,
      )}
    >
      <a
        href="#main-content"
        className="bg-background text-foreground sr-only rounded-md border px-3 py-2 text-sm font-medium focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50"
      >
        {t("skipToContent")}
      </a>
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
        <Link
          href="/"
          aria-label={t("backHome")}
          className="focus-visible:ring-ring/50 rounded-md outline-none focus-visible:ring-[3px]"
        >
          <Brand />
        </Link>
        <div className="flex items-center gap-1 sm:gap-3">
          {access && status !== "loading" && (
            <Button size="sm" className="max-sm:px-2.5" asChild>
              {status === "authenticated" ? (
                <Link href="/event">
                  <span className="max-sm:sr-only">{t("goToApp")}</span>
                  <ArrowRightIcon aria-hidden="true" className="size-4" />
                </Link>
              ) : (
                <Link href={pathname === "/" ? "/login" : withReturnPath("/login", pathname)}>
                  <SignInIcon aria-hidden="true" className="size-4 sm:hidden" />
                  <span className="max-sm:sr-only">{t("logIn")}</span>
                </Link>
              )}
            </Button>
          )}
          <LanguageSelect />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
