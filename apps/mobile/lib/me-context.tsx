import { createContext, type ReactNode, useContext, useEffect, useMemo } from "react";
import { registerSignOutListener } from "./sign-out-events";
import type { Me } from "./types";
import { useMe } from "./use-me";

interface MeContextValue {
  me: Me | null;
  authenticated: boolean;
  loading: boolean;
  error: Error | null;
  /** True when `me` is being served from on-device cache because the last live fetch couldn't confirm the session. */
  offline: boolean;
  staleSince: string | null;
  offlineEntryAvailable: boolean;
  enterOffline: () => Promise<void>;
  refetch: () => Promise<Me | null>;
  clear: () => void;
}

const MeContext = createContext<MeContextValue | null>(null);

interface MeActionsContextValue {
  refetch: () => Promise<Me | null>;
  clear: () => void;
}

const MeActionsContext = createContext<MeActionsContextValue | null>(null);

/** Wraps the authenticated part of the tree in a single shared /api/me fetch. */
export function MeProvider({ children }: { children: ReactNode }) {
  const value = useMe();
  const actions = useMemo(
    () => ({ clear: value.clear, refetch: value.refetch }),
    [value.clear, value.refetch],
  );
  useEffect(() => registerSignOutListener(value.clear), [value.clear]);
  return (
    <MeActionsContext.Provider value={actions}>
      <MeContext.Provider value={value}>{children}</MeContext.Provider>
    </MeActionsContext.Provider>
  );
}

export function useMeContext(): MeContextValue {
  const ctx = useContext(MeContext);
  if (!ctx) throw new Error("useMeContext must be used within MeProvider");
  return ctx;
}

/** Stable session actions for forms that must not re-render with profile data. */
export function useMeActions(): MeActionsContextValue {
  const ctx = useContext(MeActionsContext);
  if (!ctx) throw new Error("useMeActions must be used within MeProvider");
  return ctx;
}
