// Client-side CSV helpers for table exports built from already-loaded rows.

const CSV_BOM = "﻿";

/**
 * One RFC 4180 field. Cells that spreadsheets would evaluate as a formula
 * (leading = + - @ or control whitespace) get a leading apostrophe so staff-
 * authored text can never run as one when the file is opened in Excel.
 */
export function csvField(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/** UTF-8 BOM first so Excel reads accents correctly; CRLF row separators. */
export function buildCsv(rows: string[][]): string {
  return `${CSV_BOM}${rows.map((row) => row.map(csvField).join(",")).join("\r\n")}\r\n`;
}

export function downloadCsv(filename: string, csv: string): void {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
