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
      className="fixed inset-x-4 top-1/2 z-50 mx-auto max-w-3xl -translate-y-1/2 overflow-hidden rounded-lg border border-zinc-200 bg-white p-8 pb-44 text-zinc-700 shadow-xl dark:border-zinc-800 sm:pb-8"
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

      <div className="relative z-10 max-w-xl pr-10 sm:pr-44">
        <h2 id="cookie-notice-title" className="text-balance text-2xl font-semibold text-zinc-700">
          Legally-required cookie notice
        </h2>
        <p className="mt-3 text-pretty text-xl leading-8 text-zinc-600">
          hackOS uses one in-house cookie to keep you logged in. Groundbreaking stuff, obviously.
        </p>
        <p className="mt-5 text-pretty text-xl leading-8 text-zinc-600">
          No ad trackers. No data broker circus. Just the tiny crumb the lawyers made us announce.
        </p>
      </div>

      <Image
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute bottom-0 right-0 w-52 max-w-none sm:w-72"
        height={410}
        priority
        src="/ursula-cookie.png"
        width={603}
      />
    </aside>
  );
}
