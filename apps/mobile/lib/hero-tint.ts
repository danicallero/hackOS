const NEUTRAL: RGB = [142, 142, 147];

/** The hero of a person without a photo (system blue). */
export const NO_PHOTO_TINT: RGB = [0, 122, 255];

export type RGB = [number, number, number];

function parseHex(hex: string | null | undefined): RGB | null {
  const match = /^#([0-9a-f]{6})$/i.exec(hex ?? "");
  if (!match) return null;
  const n = Number.parseInt(match[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance([r, g, b]: RGB): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * Hero tint from a logo's or photo's dominant colour (`color`, "#rrggbb"; null
 * falls back to a neutral grey): a gradient fading to transparent over the screen background,
 * plus the foreground (white or black) that reads on the tint at the strongest
 * point of the gradient. Dark mode darkens the tint so it does not glare.
 */
export function heroTint(
  color: string | null | undefined,
  dark: boolean,
  fallback: RGB = NEUTRAL,
): { gradient: string; foreground: "white" | "black" } {
  const base = parseHex(color) ?? fallback;
  const tint = (dark ? base.map((v) => Math.round(v * 0.6)) : base) as RGB;
  const alpha = dark ? 0.85 : 0.8;
  const ground = dark ? 0 : 255;
  const shown = tint.map((v) => Math.round(v * alpha + ground * (1 - alpha))) as RGB;
  // Contrast against white vs black text: pick the better one.
  const foreground = luminance(shown) > 0.179 ? "black" : "white";
  const [r, g, b] = tint;
  return {
    gradient: `linear-gradient(to bottom, rgba(${r},${g},${b},${alpha}) 0%, rgba(${r},${g},${b},0) 100%)`,
    foreground,
  };
}
