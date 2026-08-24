"use client";

import { type Dispatch, type SetStateAction, useEffect, useState } from "react";

/**
 * Like useState, but the value survives navigating away and back (e.g. via
 * BackLink's router.back()) by round-tripping through sessionStorage under
 * `key`. Scoped to the tab/session — never sent anywhere, never shared
 * across users. Pass `key: null` to opt out and behave like plain useState
 * (e.g. when the caller doesn't want this particular instance persisted).
 */
export function usePersistedState<T>(
  key: string | null,
  initial: T,
): [T, Dispatch<SetStateAction<T>>] {
  const [state, setState] = useState<T>(() => {
    if (!key || typeof window === "undefined") return initial;
    try {
      const raw = window.sessionStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    if (!key) return;
    try {
      window.sessionStorage.setItem(key, JSON.stringify(state));
    } catch {
      // storage full/unavailable — state just won't survive a back-navigation
    }
  }, [key, state]);

  return [state, setState];
}
