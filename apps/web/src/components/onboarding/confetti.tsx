"use client";

import { useEffect, useState } from "react";

const COLORS = ["var(--primary)", "var(--chart-2, #f59e0b)", "var(--chart-3, #22c55e)", "var(--chart-4, #3b82f6)"];
const PIECES = 36;

/** True when the person asked the system to reduce motion. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

/**
 * One short burst on the completion step. It is decorative (aria-hidden,
 * pointer-events none) and renders nothing at all under reduced motion.
 */
export function Confetti() {
  const reduced = usePrefersReducedMotion();
  if (reduced) return null;
  return (
    <div
      aria-hidden="true"
      data-testid="onboarding-confetti"
      className="pointer-events-none fixed inset-0 z-50 overflow-hidden"
    >
      {Array.from({ length: PIECES }, (_, index) => {
        const left = (index * 97) % 100;
        return (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed decorative pieces.
            key={index}
            className="onboarding-confetti-piece absolute top-0 block h-3 w-2 rounded-xs"
            style={{
              left: `${left}%`,
              background: COLORS[index % COLORS.length],
              animationDelay: `${(index % 9) * 90}ms`,
              animationDuration: `${1800 + (index % 5) * 240}ms`,
              transform: `rotate(${index * 37}deg)`,
            }}
          />
        );
      })}
    </div>
  );
}
