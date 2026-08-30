import { apiFetch } from "./api";

export interface ScanLogEntry {
  id: number;
  source: "accreditation" | "door" | "activity";
  occurredAt: string;
  detail: string | null;
  subjectUserId: number;
  subjectName: string;
  subjectSurname: string;
  badgeId: string | null;
  method: "manual" | "qr" | "nfc" | null;
  activityId: number | null;
  activityName: string | null;
  activityCategory: string | null;
  doorKind: "in" | "out" | null;
  doorLocation: string | null;
  notes: string | null;
}

export interface ScanLogPage {
  items: ScanLogEntry[];
  total: number;
}

/** Team-wide scan-log feed for the caller's own scans (Part 2, `docs/mobile.md`). */
export function fetchScanLog(limit: number, offset: number): Promise<ScanLogPage> {
  return apiFetch<ScanLogPage>(`/api/logistics/scan-log?limit=${limit}&offset=${offset}`);
}

export interface MyScanStats {
  accreditationCount: number;
  presenceCount: number;
  activityCount: number;
  totalCount: number;
  uniquePeopleCount: number;
  lastScanAt: string | null;
}

/** The caller's own scan counts, shown on the staff Statistics page (Part 3). */
export function fetchMyScanStats(): Promise<MyScanStats> {
  return apiFetch<MyScanStats>("/api/me/logistics/stats");
}
