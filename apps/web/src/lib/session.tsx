"use client";

import { CAPABILITIES, type Capability } from "@hackos/shared/capabilities";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ApiError, api } from "./api";
import type { Me } from "./types";

type SessionStatus = "loading" | "authenticated" | "unauthenticated";

interface SessionContextValue {
  me: Me | null;
  status: SessionStatus;
  /** Last refresh failure, retained so pending-removal can offer retry without redirecting. */
  error: Error | null;
  /** Re-fetch /api/me (after profile edits, permission changes, login). */
  refresh: () => Promise<void>;
  /** True if the user holds `capability` (or the `*` admin wildcard). H8. */
  can: (capability: Capability) => boolean;
  /** True if the user holds ANY of the listed capabilities. */
  canAny: (...capabilities: Capability[]) => boolean;
  /**
   * Authenticated, but with no confirmed spot and no operational role
   * (capability, room judge, sponsor rep) — an applicant with nothing to do
   * in the app yet besides applying. Drives hiding participant-only nav
   * (wallet/queue/project/inbox).
   */
  isPureApplicant: boolean;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [status, setStatus] = useState<SessionStatus>("loading");
  const [error, setError] = useState<Error | null>(null);
  const meRef = useRef<Me | null>(null);
  const requestId = useRef(0);

  const refresh = useCallback(async () => {
    const currentRequest = ++requestId.current;
    try {
      const data = await api.get<Me>("/api/me");
      if (currentRequest !== requestId.current) return;
      meRef.current = data;
      setMe(data);
      setStatus("authenticated");
      setError(null);
    } catch (err) {
      if (currentRequest !== requestId.current) return;
      if (err instanceof ApiError && err.status === 401) {
        meRef.current = null;
        setMe(null);
        setStatus("unauthenticated");
        setError(null);
        return;
      }
      // A pending-removal session must remain on the authoritative screen
      // while /api/me has a transient network/5xx failure. Clearing `me`
      // here would make AuthGuard redirect to login and hide the retry path.
      setError(err instanceof Error ? err : new Error("Failed to refresh session"));
      if (meRef.current) {
        setStatus("authenticated");
        return;
      }
      // Before the first successful profile fetch there is no safe identity
      // to render, so preserve the existing unauthenticated gate behavior.
      setMe(null);
      setStatus("unauthenticated");
    }
  }, []);

  // Fetch current session from server on mount; setState is sync, but this is external-system fetch.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const value = useMemo<SessionContextValue>(() => {
    const caps = new Set<string>(me?.capabilities ?? []);
    const can = (capability: Capability) =>
      caps.has(CAPABILITIES.ADMIN_ALL) || caps.has(capability);
    return {
      me,
      status,
      error,
      refresh,
      can,
      canAny: (...capabilities: Capability[]) => capabilities.some(can),
      isPureApplicant:
        !!me && !me.hasEventAccess && !me.isEnterpriseJudge && !me.isSponsorRep && caps.size === 0,
    };
  }, [me, status, error, refresh]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSessionContext(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSessionContext must be used within <SessionProvider>");
  return ctx;
}

/** Convenience: current user or null. */
export function useMe(): Me | null {
  return useSessionContext().me;
}

/** Convenience capability check hook (H8). */
export function useCan(capability: Capability): boolean {
  return useSessionContext().can(capability);
}
