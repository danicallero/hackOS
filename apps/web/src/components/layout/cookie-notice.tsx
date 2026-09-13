"use client";

import { X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { IconButton } from "@/components/common/icon-button";
import { useLocale } from "@/lib/i18n";

const STORAGE_KEY = "hackos.cookie-notice.dismissed";

export function CookieNotice() {
  const { t } = useLocale();
  const [isVisible, setIsVisible] = useState(
    () => typeof window !== "undefined" && window.localStorage.getItem(STORAGE_KEY) !== "true",
  );

  function dismiss() {
    window.localStorage.setItem(STORAGE_KEY, "true");
    setIsVisible(false);
  }

  if (!isVisible) {
    return null;
  }

  return (
    <aside
      aria-labelledby="cookie-notice-title"
      className="bg-card text-card-foreground fixed z-50 w-[calc(100vw-2rem)] max-w-xl overflow-hidden rounded-surface border shadow-xl"
      style={{
        bottom: "max(1rem, env(safe-area-inset-bottom))",
        right: "max(1rem, env(safe-area-inset-right))",
      }}
    >
      {/* Keep copy and dismissal in separate grid tracks so long localized text cannot cover the close control (#676). */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 p-4 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:gap-4 sm:p-5">
        <div className="col-start-1 row-start-1 min-w-0 wrap-break-word sm:col-start-2">
          <h2 id="cookie-notice-title" className="text-balance text-base font-semibold sm:text-lg">
            {t("cookieNoticeTitle")}
          </h2>
          <p className="text-muted-foreground mt-1.5 text-pretty text-xs leading-5 sm:text-sm">
            {t("cookieNoticeBody")}
          </p>
          <p className="text-muted-foreground mt-1.5 text-pretty text-xs leading-5 sm:text-sm whitespace-pre-line">
            {t("cookieNoticeJoke")}
          </p>
          <p className="mt-2 text-xs sm:text-sm">
            <Link className="font-medium underline underline-offset-4" href="/privacy">
              {t("cookieNoticePrivacyLink")}
            </Link>
          </p>
        </div>

        <IconButton
          label={t("dismissCookieNotice")}
          className="text-muted-foreground hover:bg-accent hover:text-accent-foreground col-start-2 row-start-1 shrink-0 sm:col-start-3"
          onClick={dismiss}
          size="icon-lg"
          type="button"
          variant="ghost"
        >
          <X className="size-4" aria-hidden="true" />
        </IconButton>

        <Image
          alt=""
          aria-hidden="true"
          className="col-start-1 row-start-2 w-36 max-w-none self-end sm:col-start-1 sm:row-start-1 sm:w-48"
          height={410}
          priority
          src="/ursula-cookie.png"
          width={603}
        />
      </div>
    </aside>
  );
}
