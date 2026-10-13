"use client";

import { api } from "@/lib/api";
import { useServerResource } from "./use-server-resource";

const KEY = ["public", "event", "shirt-sizes"] as const;

const fetchShirtSizes = (signal: AbortSignal) =>
  api.get<{ shirtSizes: string[] }>("/api/public/event", { signal }).then((r) => r.shirtSizes);

/**
 * The event's configured shirt-size options (H12), shared by every picker in
 * the app (applications, invite claim, profile self-edit, staff user-edit)
 * so an organizer can add/remove a size from one place in event settings
 * instead of a hardcoded list per screen. Public endpoint — works for
 * unauthenticated invite-claim pages too. On failure `sizes` is empty and
 * `error` is set: never a list the event may not offer.
 */
export function useShirtSizes(): {
  sizes: string[];
  loading: boolean;
  error: unknown;
  reload: () => void;
} {
  const { data, loading, error, reload } = useServerResource(KEY, fetchShirtSizes);
  return { sizes: data ?? [], loading, error, reload };
}
