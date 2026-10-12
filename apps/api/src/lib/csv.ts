import type { FastifyReply } from "fastify";

/** Plain text/csv rendering, no external dep. Shared by every CSV export route (H40, H54). */

export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = v instanceof Date ? v.toISOString() : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function recordsToCsv(header: string[], rows: Record<string, unknown>[]): unknown[][] {
  return rows.map((r) => header.map((h) => r[h]));
}

export function toCsv(header: string[], rows: unknown[][]): string {
  const lines = [header.join(",")];
  for (const row of rows) lines.push(row.map(csvCell).join(","));
  return `${lines.join("\r\n")}\r\n`;
}

/** Send a CSV download. Exports carry personal data, so they are never cached. */
export function sendCsv(reply: FastifyReply, filename: string, csv: string) {
  reply.header("content-type", "text/csv; charset=utf-8");
  reply.header("content-disposition", `attachment; filename="${filename}"`);
  reply.header("cache-control", "private, no-store");
  return reply.send(csv);
}
