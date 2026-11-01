"use client";

import { ArrowRightIcon } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { SignInIcon } from "@phosphor-icons/react/dist/csr/SignIn";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { Brand } from "@/components/common/brand";
import { LanguageSelect } from "@/components/common/language-select";
import { ThemeToggle } from "@/components/common/theme-toggle";
import { SkipToContent } from "@/components/layout/skip-to-content";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n";
import { withReturnPath } from "@/lib/return-path";
import { useSessionContext } from "@/lib/session";
import { cn } from "@/lib/utils";

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
  const header = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = header.current;
    if (!element) return;
    const updateHeight = () => {
      document.documentElement.style.setProperty(
        "--public-header-height",
        `${element.getBoundingClientRect().height}px`,
      );
    };
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(element);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty("--public-header-height");
    };
  }, []);
  return (
    <header
      ref={header}
      className={cn(
        "bg-background/90 sticky top-0 z-40 shrink-0 border-b backdrop-blur supports-[backdrop-filter]:bg-background/80",
        className,
      )}
    >
      <SkipToContent />
      <div className="mx-auto flex min-h-16 w-full max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Link
          href="/"
          aria-label={`hackOS — ${t("backHome")}`}
          className="focus-visible:ring-ring/50 max-w-full rounded-md outline-none focus-visible:ring-[3px]"
        >
          <Brand className="max-w-full flex-wrap" />
        </Link>
        <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-1 sm:gap-3">
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
