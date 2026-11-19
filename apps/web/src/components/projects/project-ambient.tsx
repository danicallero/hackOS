"use client";

import { createContext, useContext, useState } from "react";

/** The cover image the gallery shows now (H18, H48), as `fieldKey` and `objectKey`. */
type Active = { fieldKey: string; objectKey: string } | null;

const AmbientContext = createContext<{
  active: Active;
  setActive: (active: Active) => void;
} | null>(null);

/**
 * Shares the gallery's visible photo with the record hero, so the hero's
 * ambient backdrop follows the carousel. Wrap the hero and the overview in it.
 */
export function ProjectAmbientProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState<Active>(null);
  return <AmbientContext value={{ active, setActive }}>{children}</AmbientContext>;
}

/** The photo the gallery shows now, null before it reports one or outside a provider. */
export function useAmbientActive(): Active {
  return useContext(AmbientContext)?.active ?? null;
}

/** Reports the carousel's visible photo; a no-op outside a provider (judging panel). */
export function useAmbientReporter(): ((active: Active) => void) | undefined {
  return useContext(AmbientContext)?.setActive;
}
