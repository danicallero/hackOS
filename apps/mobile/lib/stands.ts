import { ApiError } from "./api";
import type { MessageKey } from "./i18n";

/** One company tag (#935): an NFC tag or wristband by serial number, or a QR token. */
export interface StandTag {
  id: number;
  kind: "nfc" | "qr";
  code: string;
  label: string | null;
  createdAt: string;
}

/** #935 staff company-tag management, as `GET /api/enterprises/stands` returns it. */
export interface StandSummary {
  tags: StandTag[];
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

/**
 * Why linking a tag failed. A 409 says whether the tag is already someone's
 * badge (or ticket) or already a stand, without naming either.
 */
export function standLinkErrorKey(error: unknown): MessageKey {
  if (error instanceof ApiError && error.status === 409) {
    const usedBy = (error.details as { usedBy?: string } | undefined)?.usedBy;
    if (usedBy === "stand") return "standsTagIsStand";
    if (usedBy === "badge" || usedBy === "ticket") return "standsTagIsBadge";
  }
  return "standsLinkFailed";
}

const NAME_ORDER = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

/** Accent- and case-insensitive name filter, alphabetical like the web table. */
export function filterStands(stands: StandSummary[], query: string): StandSummary[] {
  const fold = (value: string) =>
    value
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLocaleLowerCase();
  const needle = fold(query.trim());
  return stands
    .filter((stand) => !needle || fold(stand.name).includes(needle))
    .sort((a, b) => NAME_ORDER.compare(a.name, b.name));
}
