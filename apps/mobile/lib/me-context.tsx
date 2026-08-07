import { createContext, type ReactNode, useContext } from "react";
import type { Me } from "./types";
import { useMe } from "./use-me";

interface MeContextValue {
  me: Me | null;
  loading: boolean;
  error: Error | null;
  /** True when `me` is being served from on-device cache because the last live fetch couldn't confirm the session. */
  offline: boolean;
  staleSince: string | null;
  refetch: () => Promise<void>;
}

const MeContext = createContext<MeContextValue | null>(null);

/** Wraps the authenticated part of the tree in a single shared /api/me fetch. */
export function MeProvider({
  authenticated,
  children,
}: {
  authenticated: boolean;
  children: ReactNode;
}) {
  const value = useMe(authenticated);
  return <MeContext.Provider value={value}>{children}</MeContext.Provider>;
}

export function useMeContext(): MeContextValue {
  const ctx = useContext(MeContext);
  if (!ctx) throw new Error("useMeContext must be used within MeProvider");
  return ctx;
}
