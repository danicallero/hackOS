"use client";

import { X } from "lucide-react";
import Image from "next/image";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "hackos.cookie-notice.dismissed";

export function CookieNotice() {
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
      className="fixed bottom-4 right-4 z-50 w-[calc(100vw-2rem)] max-w-[30rem] overflow-hidden rounded-lg border border-zinc-200 bg-white p-6 pb-8 text-zinc-700 shadow-xl dark:border-zinc-800 sm:bottom-6 sm:right-6 sm:w-[30rem] sm:p-8"
    >
      <Button
        aria-label="Dismiss cookie notice"
        className="absolute right-4 top-4 z-10 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950"
        onClick={dismiss}
        size="icon"
        type="button"
        variant="ghost"
      >
        <X className="size-5" aria-hidden="true" />
      </Button>

      <div className="relative z-10 pl-28 sm:pl-44">
        <h2 id="cookie-notice-title" className="text-balance text-2xl font-semibold text-zinc-700">
          Legally-required cookie notice
        </h2>
        <p className="mt-3 text-pretty text-base leading-7 text-zinc-600 sm:text-lg">
          hackOS keeps a first-party cookie and a few local settings so your theme, layout, and
          session preferences do not reset every time you blink.
        </p>
        <p className="mt-4 text-pretty text-base leading-7 text-zinc-600 sm:text-lg">
          No ad trackers. No selling your traffic. No trading your information like office supplies.
          Ursula von der Leyen may breathe easier now.
        </p>
      </div>

      <Image
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute bottom-0 left-0 w-36 max-w-none sm:w-52"
        height={410}
        priority
        src="/ursula-cookie.png"
        width={603}
      />
    </aside>
  );
}
