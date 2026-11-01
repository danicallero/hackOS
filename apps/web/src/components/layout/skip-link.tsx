"use client";

import { useLocale } from "@/lib/i18n";

/** The one landmark every shell renders; the skip link moves focus to it (#1173). */
export const MAIN_CONTENT_ID = "main-content";

/**
 * First tab stop of a shell: hidden until focused, then moves focus to the
 * page's `<main id="main-content" tabIndex={-1}>`, past the navigation.
 */
export function SkipLink() {
  const { t } = useLocale();
  return (
    <a
      href={`#${MAIN_CONTENT_ID}`}
      onClick={(event) => {
        const main = document.getElementById(MAIN_CONTENT_ID);
        if (!main) return;
        // Focus directly instead of following the fragment, so the URL stays
        // clean and focus lands even when the hash is already #main-content.
        event.preventDefault();
        main.focus();
      }}
      className="bg-background text-foreground sr-only rounded-md border text-sm font-medium focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-3 focus:py-2"
    >
      {t("skipToContent")}
    </a>
  );
}
