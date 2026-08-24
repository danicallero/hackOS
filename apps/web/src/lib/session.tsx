"use client";

import { CAPABILITIES, type Capability } from "@hackos/shared/capabilities";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ApiError, api } from "./api";
import type { Me } from "./types";

type SessionStatus = "loading" | "authenticated" | "unauthenticated";

interface SessionContextValue {
  me: Me | null;
  status: SessionStatus;
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

  const refresh = useCallback(async () => {
    try {
      const data = await api.get<Me>("/api/me");
      setMe(data);
      setStatus("authenticated");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setMe(null);
        setStatus("unauthenticated");
        return;
      }
      // Network/other error: treat as unauthenticated but keep it non-fatal.
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
      refresh,
      can,
      canAny: (...capabilities: Capability[]) => capabilities.some(can),
      isPureApplicant:
        !!me && !me.hasEventAccess && !me.isEnterpriseJudge && !me.isSponsorRep && caps.size === 0,
    };
  }, [me, status, refresh]);

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
