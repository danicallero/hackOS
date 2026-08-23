"use client";

import type { Capability } from "@hackos/shared/capabilities";
import { useSessionContext } from "@/lib/session";

/** Renders children only if the user holds the required capability — UI
 *  convenience only, the API still enforces the check. Pass `any` to require
 *  any of several capabilities (mirrors the API's `requireAnyCapability`). */
export function CapabilityGate({
  capability,
  any,
  fallback = null,
  children,
}: {
  /** Single capability required; mutually exclusive with `any`. */
  capability?: Capability;
  /** Any-of set of capabilities; mutually exclusive with `capability`. */
  any?: Capability[];
  /** Rendered when the check fails. Defaults to nothing. */
  fallback?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { can, canAny } = useSessionContext();
  const allowed = capability ? can(capability) : any ? canAny(...any) : false;
  return <>{allowed ? children : fallback}</>;
}
