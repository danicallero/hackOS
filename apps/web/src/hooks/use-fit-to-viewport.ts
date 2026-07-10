"use client";

import { useLayoutEffect, useRef, useState } from "react";

/**
 * Fits `contentRef` inside `containerRef` with zero horizontal letterboxing:
 * the grid must always span the full screen width edge-to-edge (H41 — every
 * TV size/aspect ratio, not just a shrunken slice of a landscape design), and
 * only the height axis is allowed to drive scaling.
 *
 * `contentWidthPercent` is the CSS width (as a %, e.g. "125%") the caller
 * must apply to the *same* element before the `scale` transform: widening it
 * by `1 / scale` pre-transform means the transform brings it back to exactly
 * 100% of the container post-transform, instead of shrinking width along
 * with height under a single uniform `scale()`. This is safe because every
 * label in these cards is single-line `truncate` text, so natural height
 * never depends on width — no feedback loop between the two.
 */
export function useFitToViewport(maxScale = 1.4) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [containerWidth, setContainerWidth] = useState(0);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return;

    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const availableHeight = container.clientHeight;
        const naturalHeight = content.offsetHeight;
        setContainerWidth(container.clientWidth);
        if (!naturalHeight) return;
        const next = Math.min(availableHeight / naturalHeight, maxScale);
        setScale(Number.isFinite(next) && next > 0 ? next : 1);
      });
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    observer.observe(content);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [maxScale]);

  const contentWidthPercent = scale > 0 ? 100 / scale : 100;

  return { containerRef, contentRef, scale, containerWidth, contentWidthPercent };
}
