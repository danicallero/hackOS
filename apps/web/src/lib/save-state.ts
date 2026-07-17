import type { Translate } from "@/lib/i18n";

/** Persistent per-scope save status shown next to the thing it describes (H29 audit: one save owner per scope). */
export type SaveState = "saved" | "saving" | "unsaved" | "error";

export function saveStateLabel(state: SaveState, t: Translate): string {
  return {
    saved: t("saveStateSaved"),
    saving: t("saveStateSaving"),
    unsaved: t("saveStateUnsaved"),
    error: t("saveStateError"),
  }[state];
}
