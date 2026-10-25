"use client";

import Link from "next/link";
import { useLocale } from "@/lib/i18n";

/** Legal links closing every public surface; same container and type as `PublicTopBar`. */
export function PublicFooter() {
  const { t } = useLocale();
  return (
    <footer className="text-muted-foreground border-t text-sm">
      <nav
        aria-label={t("legalLinksLabel")}
        className="mx-auto flex w-full max-w-7xl flex-wrap justify-center gap-x-5 gap-y-2 px-4 py-6 sm:px-6"
      >
        <Link className="underline underline-offset-4 hover:text-foreground" href="/terms">
          {t("termsAndConditions")}
        </Link>
        <Link className="underline underline-offset-4 hover:text-foreground" href="/privacy">
          {t("privacyPolicy")}
        </Link>
      </nav>
    </footer>
  );
}
