"use client";

import { useEffect, useState } from "react";
import type { SaveState } from "@/lib/save-state";

/**
 * Derives a category's persistent Unsaved/Saving/Saved/Error indicator from
 * its form's dirty flag, and reports dirtiness up to the settings shell so it
 * can warn before navigating away. Submit handlers still call the returned
 * setter directly for the "saving"/"saved"/"error" transitions around the
 * actual request — this hook only owns the "first edit → unsaved" step.
 */
export function useCategorySaveState(
  isDirty: boolean,
  onDirtyChange: (dirty: boolean) => void,
): [SaveState, (state: SaveState) => void] {
  const [state, setState] = useState<SaveState>("saved");

  useEffect(() => {
    onDirtyChange(isDirty);
  }, [isDirty, onDirtyChange]);

  useEffect(() => {
    if (isDirty) setState((prev) => (prev === "saving" ? prev : "unsaved"));
  }, [isDirty]);

  return [state, setState];
}
