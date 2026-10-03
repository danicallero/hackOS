"use client";

import Image from "next/image";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n";

type ErrorKind = "not-found" | "unexpected";

/**
 * Recovery screen for errors that replace the whole route rather than one
 * data region. The illustration is decorative; the status, explanation and
 * retry control remain available as ordinary semantic content.
 */
export function FullPageError({ kind, onAction }: { kind: ErrorKind; onAction: () => void }) {
  const { t } = useLocale();
  const isNotFound = kind === "not-found";

  return (
    <main className="flex min-h-dvh items-center justify-center overflow-hidden bg-[var(--brand-blue)] px-6 py-12 text-[var(--brand-ink)]">
      <section
        aria-labelledby="error-title"
        className="grid w-full max-w-6xl items-center gap-4 md:grid-cols-[minmax(0,0.95fr)_minmax(24rem,0.85fr)] md:gap-0"
      >
        <div className="relative z-0 mx-auto aspect-square w-full max-w-sm md:max-w-md">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute top-[2%] left-[70%] w-[72%] -translate-x-1/2 md:top-[-4%] md:left-[77%] md:w-[120%]"
          >
            <Image
              src="/errors/nube.png"
              alt=""
              width={900}
              height={457}
              sizes="(max-width: 768px) 72vw, 34rem"
              className="w-full opacity-65"
            />
          </div>
          <Image
            src="/errors/emilia-404.png"
            alt=""
            aria-hidden="true"
            width={310}
            height={720}
            sizes="(max-width: 768px) 11rem, 14rem"
            className="absolute bottom-0 left-1/2 h-[88%] w-auto max-w-full -translate-x-1/2 object-contain"
          />
        </div>
        <div className="relative z-10 flex flex-col items-center text-center md:items-start md:text-left">
          <p className="font-display text-[clamp(8rem,20vw,17rem)] leading-none font-bold text-destructive tabular-nums">
            {isNotFound ? "404" : "500"}
          </p>
          <div className="mt-4 space-y-2">
            <h1 id="error-title" className="type-page-title text-balance">
              {t(isNotFound ? "pageNotFound" : "pageCouldNotLoad")}
            </h1>
            <p className="text-pretty text-[color-mix(in_srgb,var(--brand-ink)_72%,var(--brand-cream))]">
              {t(isNotFound ? "pageNotFoundDescription" : "pageCouldNotLoadDescription")}
            </p>
          </div>
          <Button
            type="button"
            size="lg"
            className="mt-6 bg-[var(--brand-ink)] text-[var(--brand-cream)] hover:opacity-90"
            onClick={onAction}
          >
            {t(isNotFound ? "backToHome" : "retry")}
          </Button>
        </div>
      </section>
    </main>
  );
}
