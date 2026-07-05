import type { Tone } from "@/lib/tones";

export type ChallengeStatus = "draft" | "active" | "published" | "archived";
export type Visibility = "visible" | "hidden";

export interface Challenge {
  id: number;
  author?: number;
  title: string;
  description: string;
  criteria: string | null;
  prizes: unknown;
  judging_panel_criteria: unknown;
  max_presentation_seconds: number | null;
  status: ChallengeStatus;
  visibility: Visibility;
  available_from: string | null;
  created_at: string;
  updated_at: string;
}

export function challengeTone(status: string): Tone {
  if (status === "published") return "success";
  if (status === "active") return "info";
  if (status === "archived") return "neutral";
  return "warning";
}

export function visibilityTone(v: Visibility): Tone {
  return v === "visible" ? "success" : "neutral";
}

export function toJsonText(value: unknown, fallback: unknown): string {
  return JSON.stringify(value ?? fallback, null, 2);
}

export function parseJsonField(value: string, fallback: unknown): unknown {
  if (!value.trim()) return fallback;
  return JSON.parse(value);
}

export function toDatetimeLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromDatetimeLocal(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
