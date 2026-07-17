"use client";

import { X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n";

const STORAGE_KEY = "hackos.cookie-notice.dismissed";

export function CookieNotice() {
  const { t } = useLocale();
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    setIsVisible(window.localStorage.getItem(STORAGE_KEY) !== "true");
  }, []);

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
      className="bg-card text-card-foreground fixed z-50 w-[calc(100vw-2rem)] max-w-[36rem] overflow-hidden rounded-surface border shadow-xl"
      style={{
        bottom: "max(1rem, env(safe-area-inset-bottom))",
        right: "max(1rem, env(safe-area-inset-right))",
      }}
    >
      <Button
        aria-label={t("dismissCookieNotice")}
        className="text-muted-foreground hover:bg-accent hover:text-accent-foreground absolute right-4 top-4 z-10"
        onClick={dismiss}
        size="icon"
        type="button"
        variant="ghost"
      >
        <X className="size-4" aria-hidden="true" />
      </Button>

      <Image
        alt=""
        aria-hidden="true"
        className="float-left mr-3 w-36 max-w-none sm:w-48"
        height={410}
        priority
        src="/ursula-cookie.png"
        style={{ marginTop: "5rem" }}
        width={603}
      />

      <div className="p-4" style={{ minHeight: "11rem" }}>
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
    </aside>
  );
}
