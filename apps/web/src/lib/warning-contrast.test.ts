import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type Rgb = readonly [number, number, number];

const styles = readFileSync(resolve(process.cwd(), "src/styles/theme.css"), "utf8");

function themeBlock(selector: string) {
  const match = styles.match(new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\n\\}`));
  if (!match) throw new Error(`Missing ${selector} theme block`);
  return match[1];
}

function themeTokens(selector: string) {
  const declarations = `${themeBlock(":root")}\n${selector === ":root" ? "" : themeBlock(selector)}`;
  return Object.fromEntries(
    [...declarations.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((match) => [match[1], match[2]]),
  );
}

function tokenColor(tokens: Record<string, string>, name: string): Rgb {
  const resolveColor = (value: string): Rgb => {
    if (/^#[\da-f]{6}$/i.test(value)) {
      const channel = (offset: number) =>
        Number.parseInt(value.slice(offset, offset + 2), 16) / 255;
      return [channel(1), channel(3), channel(5)];
    }
    const reference = value.match(/^var\((--[\w-]+)\)$/);
    if (reference) return tokenColor(tokens, reference[1]);
    const mix = value.match(
      /^color-mix\(in srgb, (var\(--[\w-]+\)) ([\d.]+)%, (var\(--[\w-]+\))\)$/,
    );
    if (mix) return blend(resolveColor(mix[1]), resolveColor(mix[3]), Number(mix[2]) / 100);
    throw new Error(`Unsupported color: ${value}`);
  };
  const value = tokens[name];
  if (!value) throw new Error(`Missing ${name}`);
  return resolveColor(value);
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
      const theme = themeTokens(selector);
      const warning = tokenColor(theme, "--warning");
      const warningForeground = tokenColor(theme, "--warning-foreground");
      const foreground = tokenColor(theme, "--foreground");
      const card = tokenColor(theme, "--card");
      const shell = selector === ":root" ? card : tokenColor(theme, "--hackos-shell");

      // StatCard's 5% wash, alerts/banner's 10% wash, and StatusBadge's 10% wash.
      expectAa(warningForeground, blend(warning, card, 0.05));
      expectAa(warningForeground, blend(warning, shell, 0.1));
      expectAa(foreground, blend(warning, card, 0.1));
      // The verification button's 10% wash is nested in its banner's 10% wash.
      expectAa(warningForeground, blend(warning, blend(warning, shell, 0.1), 0.1));
    }
  });
});

describe("edition theme contrast", () => {
  it("keeps action labels, muted text, status text and field outlines legible in both themes", () => {
    for (const selector of [":root", "\\.dark"]) {
      const theme = themeTokens(selector);
      for (const surface of [
        "background",
        "card",
        "popover",
        "primary",
        "secondary",
        "accent",
        "destructive",
        "success",
        "sidebar",
        "sidebar-primary",
        "sidebar-accent",
      ]) {
        expectAa(
          tokenColor(
            theme,
            `--${surface}-foreground`.replace("--background-foreground", "--foreground"),
          ),
          tokenColor(theme, `--${surface}`),
        );
      }
      for (const surface of ["--background", "--card", "--hackos-shell", "--secondary"]) {
        const background = tokenColor(theme, surface);
        expectAa(tokenColor(theme, "--muted-foreground"), background);
        expect(contrast(tokenColor(theme, "--input"), background)).toBeGreaterThanOrEqual(3);
        for (const tone of ["--success", "--destructive", "--info"]) {
          const color = tokenColor(theme, tone);
          expectAa(color, blend(color, background, 0.05));
          expectAa(tokenColor(theme, "--foreground"), blend(color, background, 0.1));
        }
      }
    }
  });
});
