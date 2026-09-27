import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type Rgb = readonly [number, number, number];

const styles = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");

function themeBlock(selector: string) {
  const match = styles.match(new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\n\\}`));
  if (!match) throw new Error(`Missing ${selector} theme block`);
  return match[1];
}

function token(block: string, name: string) {
  const match = block.match(new RegExp(`${name}:\\s*(oklch\\([^;]+\\))`));
  if (!match) throw new Error(`Missing ${name}`);
  return match[1];
}

function oklchToRgb(value: string): Rgb {
  const match = value.match(/oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
  if (!match) throw new Error(`Unsupported color: ${value}`);

  const [lightness, chroma, hue] = match.slice(1).map(Number);
  const angle = (hue * Math.PI) / 180;
  const a = chroma * Math.cos(angle);
  const b = chroma * Math.sin(angle);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;

  const [red, green, blue] = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((channel) => {
    const linear = Math.min(1, Math.max(0, channel));
    return linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055;
  });
  return [red, green, blue];
}

function blend(overlay: Rgb, background: Rgb, alpha: number): Rgb {
  return [
    overlay[0] * alpha + background[0] * (1 - alpha),
    overlay[1] * alpha + background[1] * (1 - alpha),
    overlay[2] * alpha + background[2] * (1 - alpha),
  ];
}

function contrast(foreground: Rgb, background: Rgb) {
  const luminance = (color: Rgb) =>
    color.reduce(
      (sum, channel, index) =>
        sum +
        [0.2126, 0.7152, 0.0722][index] *
          (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4),
      0,
    );
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

function expectAa(foreground: Rgb, background: Rgb) {
  expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
}

describe("warning text contrast", () => {
  it("keeps badges, alerts, statistic cards and nested banner buttons at WCAG AA in both themes", () => {
    for (const selector of [":root", "\\.dark"]) {
      const theme = themeBlock(selector);
      const warning = oklchToRgb(token(theme, "--warning"));
      const warningForeground = oklchToRgb(token(theme, "--warning-foreground"));
      const foreground = oklchToRgb(token(theme, "--foreground"));
      const card = oklchToRgb(token(theme, "--card"));
      const shell = selector === ":root" ? card : oklchToRgb(token(theme, "--hackos-shell"));

      // StatCard's 5% wash, alerts/banner's 10% wash, and StatusBadge's 10% wash.
      expectAa(warningForeground, blend(warning, card, 0.05));
      expectAa(warningForeground, blend(warning, shell, 0.1));
      expectAa(foreground, blend(warning, card, 0.1));
      // The verification button's 10% wash is nested in its banner's 10% wash.
      expectAa(warningForeground, blend(warning, blend(warning, shell, 0.1), 0.1));
    }
  });
});
