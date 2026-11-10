"use client";

import { useCallback } from "react";
import { api } from "@/lib/api";
import { apiErrorReason } from "@/lib/api-error-reason";
import { type RsvpDraft, type RsvpItem, rsvpBody, STALE_RSVP_REASONS } from "@/lib/rsvp";
import { invalidateServerState, readServerState } from "@/lib/server-state";
import { useServerResource } from "./use-server-resource";

/**
 * The caller's open RSVPs, shared by every surface (profile section, onboarding
 * step, next-entry prompt) through one server-state resource, so saving in one
 * never leaves another submitting stale answers.
 */

const rsvpsKey = (userId: number | null) => ["me", "rsvps", userId] as const;
const fetchRsvps = (signal: AbortSignal) =>
  api.get<{ items: RsvpItem[] }>("/api/me/rsvps", { signal });

/** Localized message key for a failed RSVP save. */
export function rsvpSaveErrorKey(err: unknown) {
  const reason = apiErrorReason(err) ?? "";
  return STALE_RSVP_REASONS.has(reason) ? "rsvpChangedReview" : "couldNotSaveRsvps";
}

export function useRsvps(userId: number | null) {
  const { data, error, reload, mutate } = useServerResource(rsvpsKey(userId), fetchRsvps, {
    enabled: userId !== null,
  });

  const save = useCallback(
    async (items: readonly RsvpItem[], draft: RsvpDraft) => {
      try {
        const next = await api.put<{ items: RsvpItem[] }>("/api/me/rsvps", rsvpBody(items, draft));
        if (userId !== null) mutate(next);
        return next.items;
      } catch (err) {
        // The offered list or a lock changed under the caller: show the current list.
        if (userId !== null && STALE_RSVP_REASONS.has(apiErrorReason(err) ?? "")) {
          invalidateServerState(rsvpsKey(userId));
          await readServerState(rsvpsKey(userId), fetchRsvps).then(mutate, () => reload());
        }
        throw err;
      }
    },
    [userId, mutate, reload],
  );

  return {
    items: data?.items ?? null,
    loading: userId !== null && data === null && !error,
    loadError: data === null && Boolean(error),
    reload,
    save,
  };
}
