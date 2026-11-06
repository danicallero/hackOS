"use client";

import { domainScope, EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import { isNotFoundError } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import { useLocale } from "@/lib/i18n";
import type { ServerStateKey } from "@/lib/server-state";
import { useLiveQuery } from "./use-live-query";

/**
 * A staff-curated catalogue (universities, degrees, food intolerances) that
 * refreshes in place when another admin edits any library. `loading` is true
 * only until the first rows paint; a failed background read keeps the rows
 * and flips `stale`, so `errorMessage` is set only when there is nothing to
 * show (or the resource is gone). `failureKey` names the fallback copy.
 */
export function useLibraryList<T>(
  resourceKey: ServerStateKey,
  fetcher: (signal?: AbortSignal) => Promise<T>,
  failureKey: Parameters<ReturnType<typeof useLocale>["t"]>[0],
) {
  const { t } = useLocale();
  const { data, error, loading, stale, refetch } = useLiveQuery(
    fetcher,
    domainScope(SSE_TOPICS.LOGISTICS),
    [EVENTS.DOMAIN_CHANGED],
    { resourceKey },
  );
  const errorMessage =
    error && (data === null || isNotFoundError(error))
      ? apiErrorText(error, t, t(failureKey))
      : null;
  return { data, loading: loading && data === null, errorMessage, stale, refetch };
}
