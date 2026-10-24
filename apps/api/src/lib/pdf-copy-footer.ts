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
 * does on electronic copies. The original is untouched on disk: only the copy
 * handed to a participant carries it.
 */
export async function stampCopyFooter(
  source: Uint8Array,
  input: CopyFooterInput,
): Promise<Uint8Array> {
  const copy = COPY[input.locale];
  const pdf = await PDFDocument.load(source);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const qr = await pdf.embedPng(
    await QRCode.toBuffer(input.verifyUrl, { margin: 1, width: 240, errorCorrectionLevel: "M" }),
  );
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
