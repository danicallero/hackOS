"use client";

import type { Capability } from "@hackos/shared/capabilities";
import { useSessionContext } from "@/lib/session";

/**
 * Renders children only if the current user holds the required capability
 * (H8). Pure UI convenience — the API still enforces every guarded route, so
 * this is about hiding controls the user can't use, never about security.
 *
 * Pass `any` to require ANY of several capabilities (mirrors the API's
 * requireAnyCapability).
 */
export function CapabilityGate({
  capability,
  any,
  fallback = null,
  children,
}: {
  capability?: Capability;
  any?: Capability[];
  fallback?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { can, canAny } = useSessionContext();
  const allowed = capability ? can(capability) : any ? canAny(...any) : false;
  return <>{allowed ? children : fallback}</>;
}
