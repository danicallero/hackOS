"use client";
import { EVENTS, REALTIME_SCOPES } from "@hackos/shared/events";
import { api } from "@/lib/api";
import { PUBLIC_REFRESH_JITTER_MS } from "./refresh-jitter";
import { useLiveQuery } from "./use-live-query";

interface PublishedWinner {
  challengeId: number;
  challengeTitle: string | Record<string, string>;
  rank: number;
  repoId: number;
  repoName: string;
}

const NO_WINNERS: PublishedWinner[] = [];

/**
 * H60: only the published projection may feed public screens; never private
 * editor caches. A failed read is reported in `error` instead of reading as
 * "no winners".
 */
export function usePublishedWinners(path: string): {
  winners: PublishedWinner[];
  error: unknown;
  loading: boolean;
  refetch: () => void;
} {
  const { data, error, loading, refetch } = useLiveQuery(
    (signal) =>
      api.get<{ winners?: PublishedWinner[] }>(path, {
        cache: "no-store",
        credentials: "include",
        signal,
      }),
    REALTIME_SCOPES.PUBLIC_TV,
    [EVENTS.DATA_CHANGED],
    { resourceKey: ["public-winners", path], jitterMs: PUBLIC_REFRESH_JITTER_MS },
  );
  return { winners: data?.winners ?? NO_WINNERS, error, loading, refetch: () => refetch() };
}
