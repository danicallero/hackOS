/**
 * Formatters and constants shared across the judging route's files (H29-H40).
 * No JSX and no fetching — anything here must stay trivially importable from
 * every panel in this directory.
 */

import type { Question } from "@hackos/shared/questions";
import { ApiError } from "@/lib/api";
import { API_URL } from "@/lib/env";
import type { Translate } from "@/lib/i18n";
import type { QueueEntry } from "@/lib/queue";
import { type Challenge, textForDisplay } from "../challenges/shared";

/**
 * Stable empty panel. Shared identity matters: this is read into `useEffect`
 * dependency lists, and a fresh `[]` per render would retrigger them forever.
 */
export const EMPTY_PANEL: Question[] = [];

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

/**
 * Keep queue errors scannable: a short context stays in Sileo's compact pill
 * while the server's useful explanation becomes the expandable description.
 * H30 gets a localized explanation because the API conflict message is a
 * transport-level invariant, not user-facing copy.
 */
export function queueErrorToastContent(
  err: unknown,
  fallbackTitle: string,
  busyTitle: string,
  busyDescription: string,
) {
  const message = errorMessage(err, fallbackTitle);
  const isBusyTeam = message.includes("(H30)") || /^Busy in /i.test(message);
  const title = isBusyTeam ? busyTitle : fallbackTitle;
  const description = isBusyTeam
    ? busyDescription
    : message === fallbackTitle
      ? undefined
      : message;

  return { message, title, description, isBusyTeam };
}
