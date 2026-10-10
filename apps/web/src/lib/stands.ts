// Company tags (#935): shared by the enterprise Tags tab and the staff
// Company tags page. Contracts mirror apps/api/src/modules/sponsors/stands.ts
// (the API keeps the original `stand` naming).

import { ApiError } from "./api";
import type { MessageKey } from "./i18n";

export interface StandTag {
  id: number;
  kind: "nfc" | "qr";
  code: string;
  /** Optional staff label to tell a company's tags apart. */
  label: string | null;
  createdAt: string;
}

/** One row of `GET /api/enterprises/stands`. */
export interface StandSummary {
  enterpriseId: number;
  name: string;
  logoUrl: string | null;
  logoNegativeUrl: string | null;
  visibility: "visible" | "hidden";
  availableFrom: string | null;
  scannable: boolean;
  nfcCount: number;
  qrCount: number;
  latestQrTagId: number | null;
  tags: StandTag[];
}

/** Same encoding as badges (docs/mobile.md): 7-byte UID, uppercase hex. */
export function normalizeUid(value: string): string {
  return value.replace(/[:\s-]/g, "").toUpperCase();
}

export const UID_PATTERN = /^[0-9A-F]{14}$/;

export const LABEL_MAX = 40;

/** A QR token shortened for dense lists: `STAND-…HT3W`. NFC serials stay whole. */
export function displayCode(tag: Pick<StandTag, "kind" | "code">): string {
  return tag.kind === "qr" ? `STAND-…${tag.code.slice(-4)}` : tag.code;
}

/** The labelled, print-quality SVG the API renders for one QR tag. */
export function standQrSvgPath(enterpriseId: number, tagId: number): string {
  return `/api/enterprises/${enterpriseId}/stand-tags/${tagId}/qr.svg`;
}

/** Inline message for a 409 on linking a tag: a person's badge, or already a company tag? */
export function standTagInUseKey(err: unknown): MessageKey | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  const usedBy = (err.details as { usedBy?: string } | undefined)?.usedBy;
  if (usedBy === "badge" || usedBy === "ticket") return "standTagInUseBadge";
  if (usedBy === "stand") return "standTagInUseStand";
  return "standTagInUse";
}
