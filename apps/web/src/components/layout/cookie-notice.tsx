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
      className="fixed bottom-4 right-4 z-50 w-[calc(100vw-2rem)] max-w-[36rem] overflow-hidden rounded-lg border border-zinc-200 bg-white text-zinc-700 shadow-xl dark:border-zinc-800 sm:bottom-6 sm:right-6"
    >
      <Button
        aria-label="Dismiss cookie notice"
        className="absolute right-4 top-4 z-10 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950"
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
        <h2
          id="cookie-notice-title"
          className="text-balance text-base font-semibold text-zinc-700 sm:text-lg"
        >
          Legally-required cookie notice
        </h2>
        <p className="mt-1.5 text-pretty text-xs leading-5 text-zinc-600 sm:text-sm">
          hackOS keeps a first-party session cookie and a few local settings so your theme, layout,
          and session preferences do not reset every time you blink. Groundbreaking, we know.
        </p>
        <p className="mt-1.5 text-pretty text-xs leading-5 text-zinc-600 sm:text-sm">
          No ad trackers. No selling your traffic. No trading your information like office supplies.
          <br />
          Ursula von der Leyen may breathe easier now.
        </p>
      </div>
    </aside>
  );
}
