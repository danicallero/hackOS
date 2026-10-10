import QRCode from "qrcode";
import { config } from "../../config.js";

/**
 * Printable company-tag QR (#935): a vector SVG with the company name
 * underneath, so a sheet of codes can be told apart once printed. The QR
 * holds the tag's link (`companyTagUrl`), so a phone camera opens the app or
 * the web fallback; the in-app scanner accepts the link or the bare token.
 * It is drawn as one path in module units (crisp at any print size) inside a
 * 4-module quiet zone, at error-correction level Q so a logo sticker or a
 * scuffed print still scans. The token is repeated in small type for manual
 * entry.
 */

/**
 * `https://<web host>/s/<code>`: the link a company tag carries (QR content
 * and the NDEF URI record staff write to NFC tags). The code is the tag's own
 * code, the NFC UID or the `STAND-` token, so the link resolves to exactly
 * that tag. The web host must be the app's associated domain.
 */
export function companyTagUrl(code: string): string {
  return `${config.WEB_URL.replace(/\/+$/, "")}/s/${encodeURIComponent(code)}`;
}

const WIDTH = 1000;
const NAME_MAX_CHARS = 60;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Dark modules as one path, merging horizontal runs. Coordinates in modules. */
function modulesPath(code: string): { size: number; path: string } {
  const { modules } = QRCode.create(code, { errorCorrectionLevel: "Q" });
  const size = modules.size;
  let path = "";
  for (let row = 0; row < size; row += 1) {
    let col = 0;
    while (col < size) {
      if (!modules.get(row, col)) {
        col += 1;
        continue;
      }
      const start = col;
      while (col < size && modules.get(row, col)) col += 1;
      path += `M${start} ${row}h${col - start}v1h${start - col}z`;
    }
  }
  return { size, path };
}

export function standQrSvg(code: string, companyName: string): string {
  const { size, path } = modulesPath(companyTagUrl(code));
  const quiet = 4;
  const scale = WIDTH / (size + quiet * 2);
  const name =
    [...companyName.trim()].length > NAME_MAX_CHARS
      ? `${[...companyName.trim()].slice(0, NAME_MAX_CHARS - 1).join("")}…`
      : companyName.trim();
  const lines = nameLines(name);
  const longest = Math.max(1, ...lines.map((line) => [...line].length));
  // Average glyph width is about 0.58 em; keep each line inside 90% of the width.
  const nameSize = Math.round(Math.min(84, (WIDTH * 0.9) / (0.58 * longest)));
  const lineHeight = Math.round(nameSize * 1.15);
  const firstBaseline = WIDTH + 70;
  const codeBaseline = firstBaseline + (lines.length - 1) * lineHeight + 100;
  const height = codeBaseline + 60;
  const label = escapeXml(name);
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="80mm" height="${round((80 * height) / WIDTH)}mm" viewBox="0 0 ${WIDTH} ${height}" role="img" aria-label="${label}">`,
    `<title>${label}</title>`,
    `<rect width="${WIDTH}" height="${height}" fill="#ffffff"/>`,
    `<path transform="translate(${round(quiet * scale)} ${round(quiet * scale)}) scale(${round(scale)})" d="${path}" fill="#000000" shape-rendering="crispEdges"/>`,
    `<text text-anchor="middle" font-family="Inter, 'Helvetica Neue', Helvetica, Arial, sans-serif" font-size="${nameSize}" font-weight="600" fill="#000000">${lines
      .map(
        (line, index) =>
          `<tspan x="${WIDTH / 2}" y="${firstBaseline + index * lineHeight}">${escapeXml(line)}</tspan>`,
      )
      .join("")}</text>`,
    `<text x="${WIDTH / 2}" y="${codeBaseline}" text-anchor="middle" font-family="'SFMono-Regular', Menlo, Consolas, monospace" font-size="34" letter-spacing="2" fill="#555555">${escapeXml(code)}</text>`,
    `</svg>`,
    "",
  ].join("\n");
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** One line, or two balanced at the space nearest the middle for long names. */
function nameLines(name: string): string[] {
  const chars = [...name];
  if (chars.length <= 24) return [name];
  const middle = chars.length / 2;
  let split = -1;
  chars.forEach((char, index) => {
    if (char === " " && (split === -1 || Math.abs(index - middle) < Math.abs(split - middle))) {
      split = index;
    }
  });
  if (split === -1) return [name];
  return [chars.slice(0, split).join(""), chars.slice(split + 1).join("")];
}

/** A file-system-safe name: `acme-labs-STAND-XXXX.svg`. */
export function standQrFilename(companyName: string, code: string): string {
  const slug = companyName
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return `${slug || "stand"}-${code}.svg`;
}
