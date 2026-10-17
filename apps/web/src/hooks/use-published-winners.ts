"use client";
import { EVENTS, REALTIME_SCOPES } from "@hackos/shared/events";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { PUBLIC_REFRESH_JITTER_MS } from "./refresh-jitter";
import { useEventSource } from "./use-event-source";
import { useJitteredCallback } from "./use-jittered-callback";

export interface PublishedWinner {
  challengeId: number;
  challengeTitle: string | Record<string, string>;
  rank: number;
  repoId: number;
  repoName: string;
}
/** H60: only the published projection may feed public screens; never private editor caches. */
export function usePublishedWinners(path: string) {
  const request = useRef(0);
  const [winners, setWinners] = useState<PublishedWinner[]>([]);
  const load = useCallback(async () => {
    const owned = ++request.current;
    try {
      const result = await api.get<{ winners?: PublishedWinner[] }>(path, {
        cache: "no-store",
        credentials: "include",
      });
      if (request.current === owned) setWinners(result.winners ?? []);
    } catch {
      if (request.current === owned) setWinners([]);
    }
  }, [path]);
  useEffect(() => {
    void load();
    return () => {
      request.current += 1;
    };
  }, [load]);
  const refresh = useJitteredCallback(() => void load(), PUBLIC_REFRESH_JITTER_MS);
  useEventSource(REALTIME_SCOPES.PUBLIC_TV, {
    events: [EVENTS.DATA_CHANGED],
    onEvent: refresh,
    onResync: refresh,
  });
  return winners;
}
