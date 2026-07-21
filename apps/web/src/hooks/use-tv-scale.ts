"use client";

import { useLayoutEffect, useRef, useState } from "react";

/**
 * The short side of the layout every TV view is authored against (a 1920x1080
 * panel). Scaling off the *short* side is what makes a portrait totem work:
 * `min(w/1920, h/1080)` would read a 1080x1920 screen as 0.56 and render
 * postage-stamp text on a screen that is physically just as big.
 */
export const TV_DESIGN_SHORT_SIDE = 1080;
const MIN_SCALE = 0.45;
const MAX_SCALE = 3;

/**
 * Resolution adaptivity for TV surfaces (H41): a venue screen may be a 1080p
 * panel, a 4K wall, or a portrait totem, and nobody can scroll, zoom or
 * squint at any of them. The frame measures itself and derives one scale
 * factor from its short side, which `TvScreen` applies as the root font size —
 * every view sizes itself in `em`, so one number drives the whole layout. A
 * 1080p panel scales 1x, a 4K wall 2x, and a portrait totem matches the 1080p
 * panel rather than shrinking to fit a landscape design.
 *
 * Deliberately not a `scale()` transform: transforms change the layout width
 * post-measurement, which feeds back into any text that wraps (see the
 * docblock on `useFitToViewport`, which is only safe because its content is
 * single-line). Font-size scaling reflows once and settles.
 */
export function useTvScale() {
  const ref = useRef<HTMLDivElement>(null);
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

  const raw = size.width ? Math.min(size.width, size.height) / TV_DESIGN_SHORT_SIDE : 1;
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, raw));

  return {
    ref,
    scale,
    width: size.width,
    height: size.height,
    /** Portrait totems get a stacked layout instead of a squeezed landscape one. */
    portrait: size.height > size.width,
  };
}
