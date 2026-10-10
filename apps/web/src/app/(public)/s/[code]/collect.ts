import { ApiError } from "@/lib/api";
import type { MessageKey } from "@/lib/i18n";

/** What `POST /api/me/diary/scan` returns that the company tag page shows (#935). */
export interface ScanResult {
  kind: "person" | "sponsor";
  sponsor: {
    enterpriseId: number;
    name: string;
    logoUrl: string | null;
    logoNegativeUrl: string | null;
  } | null;
  person: { displayName: string } | null;
}

/** Business errors this page explains in the reader's language; others keep the API text. */
export function collectErrorKey(err: unknown): MessageKey | null {
  if (!(err instanceof ApiError)) return "companyTagFailed";
  if (err.code === "stand_unavailable") return "companyTagUnavailable";
  if (err.code === "diary_code_unknown") return "companyTagUnknown";
  if (err.status === 403) return "companyTagAttendeesOnly";
  if (err.status === 429) return "companyTagRateLimited";
  return null;
}
