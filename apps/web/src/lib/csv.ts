// The one client-side CSV builder: every export of already-loaded rows goes through it.

import { saveBlob } from "./download";

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

/** Saves already-built CSV text (see `buildCsv`) as `filename`. */
export function downloadCsv(filename: string, csv: string): void {
  saveBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), filename);
}

/** Builds the CSV for `rows` (formula-safe, BOM, CRLF) and saves it as `filename`. */
export function exportCsv(filename: string, rows: string[][]): void {
  downloadCsv(filename, buildCsv(rows));
}
