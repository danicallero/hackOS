"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const MARQUEE_PAUSE_MS = 1600;
const MARQUEE_PIXELS_PER_SECOND = 45;

/** Shared clock so every marquee on the page moves in lockstep instead of
 * each finishing its own trip whenever: all wait together, all set off
 * together (each at its own natural speed), the shorter ones hold at the end
 * until the longest one catches up, all wait together again, then all
 * return together the same way. One coordinator per page is exactly what we
 * want here — there is only ever one TV screen mounted per tab. */
class MarqueeCoordinator {
  private overflows = new Map<symbol, number>();
  private listeners = new Set<() => void>();
  private maxOverflow = 0;

  report(key: symbol, overflow: number) {
    if (overflow > 0) this.overflows.set(key, overflow);
    else this.overflows.delete(key);
    this.recompute();
  }

  remove(key: symbol) {
    this.overflows.delete(key);
    this.recompute();
  }

  private recompute() {
    let max = 0;
    for (const value of this.overflows.values()) max = Math.max(max, value);
    if (max !== this.maxOverflow) {
      this.maxOverflow = max;
      for (const listener of this.listeners) listener();
    }
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  get maxTravelMs() {
    return (this.maxOverflow / MARQUEE_PIXELS_PER_SECOND) * 1000;
  }
}

const marqueeCoordinator = new MarqueeCoordinator();

/** Kiosk-only alternative to a static `truncate` ellipsis (H41: nobody can
 * hover, click, or scroll to read the rest). Only when the text actually
 * overflows its box, scroll it into view on a loop: pause at the start,
 * scroll to reveal the clipped tail, pause there, scroll back, repeat. Text
 * that already fits never animates. Every overflowing text on the page moves
 * on the same shared clock (see MarqueeCoordinator) rather than each running
 * its own independent, out-of-phase loop. */
export function MarqueeText({ text, className }: { text: string; className?: string }) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const animationRef = useRef<Animation | null>(null);
  // Use state instead of ref to avoid render-time assignment: the coordinator
  // registration key must be available synchronously and never change.
  const registrationKey = useState(() => Symbol("marquee"))[0];

  // `text` isn't read in the effect body, but a same-size container swapping
  // to different-length content (e.g. a new presenting team) must still
  // retrigger measurement. `registrationKey` is a stable state-initialized
  // symbol that never changes, listed only so exhaustive-deps is satisfied.
  // biome-ignore lint/correctness/useExhaustiveDependencies: text isn't read in the body but must still retrigger measurement on content change.
  useLayoutEffect(() => {
    const container = containerRef.current;
    const el = textRef.current;
    const key = registrationKey.current;
    if (!container || !el || !key) return;

    let ownOverflow = 0;

    const applyAnimation = () => {
      animationRef.current?.cancel();
      el.style.transform = "translateX(0)";
      if (ownOverflow <= 1) return;
      const ownTravel = (ownOverflow / MARQUEE_PIXELS_PER_SECOND) * 1000;
      // A marquee is always part of the coordinator's maximum, but retain
      // its own travel as a floor while measurements settle.
      const maxTravel = Math.max(ownTravel, marqueeCoordinator.maxTravelMs);
      const total = MARQUEE_PAUSE_MS * 2 + maxTravel * 2;
      // Own forward travel ends at o2; shorter texts then hold at full
      // offset until o3 (when the longest text arrives). Both pauses (o1-o0,
      // o4-o3) are shared by every instance. The return trip mirrors this.
      // Firefox validates offsets strictly. The longest marquee's o5 is
      // mathematically 1, but floating-point division can produce a value
      // just above 1, which makes Element.animate() throw and prevents the
      // TV screen from loading.
      const boundedOffset = (value: number) => Math.min(1, Math.max(0, value));
      const o1 = boundedOffset(MARQUEE_PAUSE_MS / total);
      const o2 = boundedOffset((MARQUEE_PAUSE_MS + ownTravel) / total);
      const o3 = boundedOffset((MARQUEE_PAUSE_MS + maxTravel) / total);
      const o4 = boundedOffset((MARQUEE_PAUSE_MS + maxTravel + MARQUEE_PAUSE_MS) / total);
      const o5 = boundedOffset(
        (MARQUEE_PAUSE_MS + maxTravel + MARQUEE_PAUSE_MS + ownTravel) / total,
      );
      const offset = `translateX(-${ownOverflow}px)`;
      animationRef.current = el.animate(
        [
          { transform: "translateX(0)", offset: 0 },
          { transform: "translateX(0)", offset: o1 },
          { transform: offset, offset: o2 },
          { transform: offset, offset: o3 },
          { transform: offset, offset: o4 },
          { transform: offset, offset: o5 },
          { transform: "translateX(0)", offset: 1 },
        ],
        { duration: total, iterations: Number.POSITIVE_INFINITY, easing: "ease-in-out" },
      );
    };

    const measure = () => {
      ownOverflow = el.scrollWidth - container.clientWidth;
      marqueeCoordinator.report(key, ownOverflow);
      applyAnimation();
    };

    measure();
    // Re-applies with the new shared pace whenever the page-wide longest
    // overflow changes (a longer/shorter name appears elsewhere).
    const unsubscribe = marqueeCoordinator.subscribe(applyAnimation);
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    observer.observe(el);
    return () => {
      animationRef.current?.cancel();
      observer.disconnect();
      unsubscribe();
      marqueeCoordinator.remove(key);
    };
  }, [text, registrationKey]);

  return (
    // `overflow-hidden` clips vertically as well as horizontally: with a tight
    // line-height it shaves the descenders of g/j/p and the accents of Á/Ó,
    // which on a wall reads as broken text. The leading below leaves room for
    // both, so only the intended horizontal clipping ever happens.
    <span
      ref={containerRef}
      className={cn("block overflow-hidden leading-[1.35] whitespace-nowrap", className)}
    >
      <span ref={textRef} className="inline-block whitespace-nowrap will-change-transform">
        {text}
      </span>
    </span>
  );
}
