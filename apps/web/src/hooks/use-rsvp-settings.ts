"use client";

import { useCallback } from "react";
import { api } from "@/lib/api";
import type { RsvpSettings } from "@/lib/rsvp";
import { useServerResource } from "./use-server-resource";

/** One schedule entry's RSVP settings with live counts (schedule:manage). */
export function useRsvpSettings(scheduleId: number | null) {
  const { data, error, reload, mutate } = useServerResource(
    ["schedule", "rsvp", scheduleId] as const,
    (signal) => api.get<RsvpSettings>(`/api/schedule/${scheduleId}/rsvp`, { signal }),
    { enabled: scheduleId !== null },
  );
  const save = useCallback(
    async (body: unknown) => {
      const next = await api.put<RsvpSettings>(
        `/api/schedule/${scheduleId}/rsvp`,
        body as Parameters<typeof api.put>[1],
      );
      mutate(next);
      return next;
    },
    [scheduleId, mutate],
  );
  return {
    settings: data,
    loading: scheduleId !== null && data === null && !error,
    loadError: data === null && Boolean(error),
    reload,
    save,
  };
}
