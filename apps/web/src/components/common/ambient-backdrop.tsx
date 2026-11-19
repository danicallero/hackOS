"use client";

import { useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/** Opaque to 60% of the hero, then fading into the page, so content below sits on the plain page. */
const MASK = "linear-gradient(to bottom, #000 60%, transparent 100%)";

export interface Ambient {
  /** Image URLs the page already shows, so the backdrop reuses their requests. */
  urls: string[];
  /** The visible one. */
  active: string;
  /** The visible one in dark mode when it differs (a negative logo). */
  activeDark?: string;
  /** Must match how the page loads the images, or the browser fetches them again. */
  crossOrigin?: "use-credentials";
}

/**
 * The image itself behind a hero (H18, H44, H48): enlarged and blurred until no
 * shape survives, under a veil of the page colour strong enough for AA text
 * contrast, cross-fading when the visible image changes (instant under reduced
 * motion). It spans the window from its top to the bottom of the hero, behind
 * the floating sidebar, and scrolls with the hero, so text after the hero never
 * sits on colour. Place it as the first child of a positioned hero.
 */
export function AmbientBackdrop({ urls, active, activeDark, crossOrigin }: Ambient) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const layer = ref.current;
    const hero = layer?.parentElement;
    if (!layer || !hero) return;
    const place = () => {
      const rect = hero.getBoundingClientRect();
      layer.style.left = `${-rect.left}px`;
      layer.style.right = `${rect.right - document.documentElement.clientWidth}px`;
      layer.style.top = `${-(rect.top + window.scrollY)}px`;
    };
    place();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(place);
    observer.observe(hero);
    observer.observe(document.documentElement);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      aria-hidden="true"
      data-hero-ambient=""
      className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
      style={{ maskImage: MASK, WebkitMaskImage: MASK }}
    >
      {/* One blur over the stack: the cross-fade blends already-blurred colours. */}
      <div className="absolute inset-0 scale-[1.4] blur-[72px]">
        {urls.map((url) => {
          const dark = url === (activeDark ?? active);
          return (
            // biome-ignore lint/performance/noImgElement: the same request the page's own image makes.
            <img
              key={url}
              src={url}
              alt=""
              crossOrigin={crossOrigin}
              data-active={url === active ? "true" : undefined}
              data-active-dark={dark ? "true" : undefined}
              className={cn(
                "absolute inset-0 size-full object-cover transition-opacity duration-700 ease-out motion-reduce:transition-none",
                url === active ? "opacity-100" : "opacity-0",
                dark ? "dark:opacity-100" : "dark:opacity-0",
              )}
            />
          );
        })}
      </div>
      <div className="absolute inset-0 bg-background/65 dark:bg-background/55" />
    </div>
  );
}
