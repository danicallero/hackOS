// Sponsor stands (#935): shared by the enterprise Stand tab and the staff
// Stands page. Contracts mirror apps/api/src/modules/sponsors/stands.ts.

import { ApiError } from "./api";
import type { MessageKey } from "./i18n";

export interface StandTag {
  id: number;
  kind: "nfc" | "qr";
  code: string;
  createdAt: string;
}

/** One row of `GET /api/enterprises/stands`. Codes are never part of it. */
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
}

/** Same encoding as badges (docs/mobile.md): 7-byte UID, uppercase hex. */
export function normalizeUid(value: string): string {
  return value.replace(/[:\s-]/g, "").toUpperCase();
}

export const UID_PATTERN = /^[0-9A-F]{14}$/;

/** The labelled, print-quality SVG the API renders for one QR tag. */
export function standQrSvgPath(enterpriseId: number, tagId: number): string {
  return `/api/enterprises/${enterpriseId}/stand-tags/${tagId}/qr.svg`;
}

/** Inline message for a 409 on linking a tag: is it a badge or already a stand? */
export function standTagInUseKey(err: unknown): MessageKey | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  const usedBy = (err.details as { usedBy?: string } | undefined)?.usedBy;
  if (usedBy === "badge" || usedBy === "ticket") return "standTagInUseBadge";
  if (usedBy === "stand") return "standTagInUseStand";
  return "standTagInUse";
}
