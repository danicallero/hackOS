"use client";

import { useLayoutEffect, useRef, useState } from "react";

/**
 * The element's own box, kept current through a ResizeObserver. For layouts
 * that can only be decided once the available space is known — a TV sponsor
 * grid picking the fewest columns whose rows still fit, say — rather than
 * guessed from breakpoints.
 */
export function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { ref, ...size };
}
