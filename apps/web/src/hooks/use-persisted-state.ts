"use client";

import { type Dispatch, type SetStateAction, useEffect, useState } from "react";

function storageFor(kind: "session" | "local"): Storage {
  return kind === "local" ? window.localStorage : window.sessionStorage;
}

/**
 * Like useState, but the value survives navigating away and back by
 * round-tripping through web storage under `key`: sessionStorage by default
 * (tab-scoped), localStorage with `{ storage: "local" }`. Never sent anywhere,
 * never shared across users. Pass `key: null` to behave like plain useState.
 */
export function usePersistedState<T>(
  key: string | null,
  initial: T,
  { storage = "session" }: { storage?: "session" | "local" } = {},
): [T, Dispatch<SetStateAction<T>>] {
  const [state, setState] = useState<T>(() => {
    if (!key || typeof window === "undefined") return initial;
    try {
      const raw = storageFor(storage).getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    if (!key) return;
    try {
      storageFor(storage).setItem(key, JSON.stringify(state));
    } catch {
      // storage full/unavailable (private mode): the value just won't survive
    }
  }, [key, state, storage]);

  return [state, setState];
}
