import { createContext, type ReactNode, useContext, useEffect } from "react";
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
  refetch: () => Promise<Me | null>;
  clear: () => void;
}

const MeContext = createContext<MeContextValue | null>(null);

/** Wraps the authenticated part of the tree in a single shared /api/me fetch. */
export function MeProvider({ children }: { children: ReactNode }) {
  const value = useMe();
  useEffect(() => registerSignOutListener(value.clear), [value.clear]);
  return <MeContext.Provider value={value}>{children}</MeContext.Provider>;
}

export function useMeContext(): MeContextValue {
  const ctx = useContext(MeContext);
  if (!ctx) throw new Error("useMeContext must be used within MeProvider");
  return ctx;
}
