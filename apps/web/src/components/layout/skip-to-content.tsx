"use client";

import { useLocale } from "@/lib/i18n";

/** H49/H55: bypass repeated chrome without adding page headings to the Tab order. */
export function SkipToContent() {
  const { t } = useLocale();
  return (
    <a
      href="#main-content"
      className="bg-background text-foreground sr-only rounded-md border px-3 py-2 text-sm font-medium focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50"
    >
      {t("skipToContent")}
    </a>
  );
}
