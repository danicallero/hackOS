import { apiFetch } from "./api";

export interface ScanLogEntry {
  id: number;
  source: "accreditation" | "door" | "activity";
  occurredAt: string;
  detail: string | null;
  subjectUserId: number;
  subjectName: string;
  subjectSurname: string;
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
}

/** The caller's own scan counts, shown on Account for operators (Part 3). */
export function fetchMyScanStats(): Promise<MyScanStats> {
  return apiFetch<MyScanStats>("/api/me/logistics/stats");
}
