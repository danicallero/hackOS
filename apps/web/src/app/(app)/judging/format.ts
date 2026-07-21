import { ApiError } from "@/lib/api";
import { API_URL } from "@/lib/env";
import type { Translate } from "@/lib/i18n";
import type { QueueEntry } from "@/lib/queue";
import { type Challenge, textForDisplay } from "../challenges/shared";

export function challengeName(
  t: Translate,
  challenge?: Challenge | null,
  fallback?: number,
): string {
  return challenge
    ? textForDisplay(challenge.title)
    : fallback
      ? t("challengeFallbackNumber", { id: fallback })
      : "—";
}

export function entryLabel(entry: QueueEntry, t: Translate): string {
  return entry.repo_name ?? t("repoNumber", { id: entry.repo_id });
}

export function secondsLabel(value: number | null | undefined): string {
  if (value == null) return "—";
  const rounded = Math.floor(value);
  const sign = rounded < 0 ? "-" : "";
  const absolute = Math.abs(rounded);
  const minutes = Math.floor(absolute / 60);
  const seconds = absolute % 60;
  return `${sign}${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

export function exportHref(path: string): string {
  return `${API_URL}${path}`;
}

export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}
