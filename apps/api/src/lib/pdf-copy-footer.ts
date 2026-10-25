import { deflateSync } from "node:zlib";
import { PDFDocument, type PDFFont, rgb, StandardFonts } from "pdf-lib";
import QRCode from "qrcode";

export type CopyLocale = "es" | "gl" | "en";

/** Height a document must leave free at the bottom of every page for the footer (#1083). */
export const COPY_FOOTER_RESERVE = 120;

const SIDE = 24;
const BOTTOM = 24;
const QR_BOX = 74;
const ROWS = { head: 28, csv: 18, note: 28 } as const;
const BLACK = rgb(0.1, 0.1, 0.1);
const FILL = rgb(0.9, 0.9, 0.9);
const LINE = rgb(0.45, 0.45, 0.45);

interface Copy {
  copyOf: (issuer: string) => string;
  printed: (date: string) => string;
  page: (n: number, total: number) => string;
  note: (url: string) => string;
}

const COPY: Record<CopyLocale, Copy> = {
  es: {
    copyOf: (issuer) => `Copia del documento - ${issuer}`,
    printed: (date) => `Fecha de impresión: ${date}`,
    page: (n, total) => `Página ${n} de ${total}`,
    note: (url) =>
      `Puede validar y/o obtener copia electrónica del documento utilizando el código QR de la izquierda o el código de verificación en la dirección ${url}`,
  },
  gl: {
    copyOf: (issuer) => `Copia do documento - ${issuer}`,
    printed: (date) => `Data impresión: ${date}`,
    page: (n, total) => `Páxina ${n} de ${total}`,
    note: (url) =>
      `Pode validar e/ou obter copia electrónica do documento utilizando o código QR da esquerda ou o código de verificación na dirección ${url}`,
  },
  en: {
    copyOf: (issuer) => `Copy of the document - ${issuer}`,
    printed: (date) => `Printed: ${date}`,
    page: (n, total) => `Page ${n} of ${total}`,
    note: (url) =>
      `You can validate and/or obtain an electronic copy of this document using the QR code on the left or the verification code at ${url}`,
  },
};

/** Standard PDF fonts cover Latin-1 only; anything else would make the render throw. */
export function printable(font: PDFFont, text: string): string {
  const supported = new Set(font.getCharacterSet());
  return [...text.normalize("NFC")]
    .map((char) => (supported.has(char.codePointAt(0) as number) ? char : "?"))
    .join("");
}

export function wrap(font: PDFFont, text: string, size: number, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && font.widthOfTextAtSize(candidate, size) > width) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function pngChunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  let crc = 0xffffffff;
  for (const byte of body) crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  const frame = Buffer.alloc(12 + data.length);
  frame.writeUInt32BE(data.length, 0);
  body.copy(frame, 4);
  frame.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 8 + data.length);
  return frame;
}

/** A QR code as a 1-bit PNG (about 1 KB; the library's RGBA export is twice that or more). */
function qrPng(text: string, scale = 6, margin = 1): Buffer {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const side = (qr.modules.size + margin * 2) * scale;
  const rowBytes = Math.ceil(side / 8);
  const raw = Buffer.alloc((rowBytes + 1) * side, 0);
  for (let y = 0; y < side; y++) {
    const row = y * (rowBytes + 1);
    raw[row] = 0;
    for (let x = 0; x < side; x++) {
      const mx = Math.floor(x / scale) - margin;
      const my = Math.floor(y / scale) - margin;
      const dark =
        mx >= 0 &&
        my >= 0 &&
        mx < qr.modules.size &&
        my < qr.modules.size &&
        qr.modules.get(mx, my);
      // 1-bit grayscale: 0 is black, 1 is white.
      if (!dark) raw[row + 1 + (x >> 3)] = (raw[row + 1 + (x >> 3)] as number) | (0x80 >> (x & 7));
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(side, 0);
  header.writeUInt32BE(side, 4);
  header.set([1, 0, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

export interface CopyFooterInput {
  issuer: string;
  /** The verification code printed as CSV and resolved by `verifyUrl`. */
  code: string;
  verifyUrl: string;
  locale: CopyLocale;
  printedAt: Date;
  timezone: string;
}

/**
 * #1083: stamps the "copy with verification code" footer (QR, print date, page
 * count, CSV and how to validate) on every page, as the Spanish administration
 * does on electronic copies. Applied once, when the certificate's single stored
 * copy is generated.
 */
export async function stampCopyFooter(
  source: Uint8Array,
  input: CopyFooterInput,
): Promise<Uint8Array> {
  const copy = COPY[input.locale];
  const pdf = await PDFDocument.load(source);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const qr = await pdf.embedPng(qrPng(input.verifyUrl));
  const printed = new Intl.DateTimeFormat(input.locale, {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: input.timezone,
  }).format(input.printedAt);
  const pages = pdf.getPages();
  const rowsHeight = ROWS.head + ROWS.csv + ROWS.note;

  pages.forEach((page, index) => {
    const { width } = page.getSize();
    const tableX = SIDE + QR_BOX + 10;
    const tableW = width - SIDE - tableX;
    const top = BOTTOM + rowsHeight;
    const text = (value: string, x: number, lineTop: number, size: number, maxWidth: number) => {
      const lines = wrap(regular, printable(regular, value), size, maxWidth);
      lines.forEach((line, i) => {
        page.drawText(line, {
          x,
          y: lineTop - size - 2 - i * (size + 1.5),
          size,
          font: regular,
          color: BLACK,
        });
      });
    };

    page.drawRectangle({
      x: SIDE,
      y: BOTTOM,
      width: QR_BOX,
      height: QR_BOX,
      borderColor: BLACK,
      borderWidth: 0.8,
    });
    page.drawImage(qr, { x: SIDE + 4, y: BOTTOM + 4, width: QR_BOX - 8, height: QR_BOX - 8 });
    page.drawRectangle({
      x: tableX,
      y: BOTTOM,
      width: tableW,
      height: rowsHeight,
      color: FILL,
      borderColor: LINE,
      borderWidth: 0.8,
    });
    const rule = (y: number, x1 = tableX, x2 = tableX + tableW) =>
      page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness: 0.8, color: LINE });
    const divider = (x: number, y1: number, y2: number) =>
      page.drawLine({ start: { x, y: y1 }, end: { x, y: y2 }, thickness: 0.8, color: LINE });

    const pageW = 78;
    const printedW = 150;
    const headSplit = tableX + tableW - pageW;
    const printedSplit = headSplit - printedW;
    const csvTop = top - ROWS.head;
    const noteTop = csvTop - ROWS.csv;
    rule(csvTop);
    rule(noteTop);
    divider(printedSplit, top, csvTop);
    divider(headSplit, top, csvTop);
    divider(printedSplit, csvTop, noteTop);

    text(copy.copyOf(input.issuer), tableX + 5, top, 8, printedSplit - tableX - 10);
    text(copy.printed(printed), printedSplit + 5, top, 8, printedW - 10);
    text(copy.page(index + 1, pages.length), headSplit + 5, top, 8, pageW - 10);
    text(`CSV: ${input.code}`, printedSplit + 5, csvTop, 8, tableW - (printedSplit - tableX) - 10);
    text(copy.note(input.verifyUrl), tableX + 5, noteTop, 7.5, tableW - 10);
  });
  return pdf.save();
}
