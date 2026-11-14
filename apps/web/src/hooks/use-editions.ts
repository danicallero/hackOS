"use client";

import type { EditionSummary, MyEditionsResponse } from "@hackos/shared/editions";
import { domainScope, EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import { useSyncExternalStore } from "react";
import { api } from "@/lib/api";
import { useMe } from "@/lib/session";
import { getViewedEdition, subscribeViewedEdition } from "@/lib/viewed-edition";
import { useLiveQuery } from "./use-live-query";

/** Editions the signed-in user can view, newest first, and the current one's key. */
export function useEditions(): { editions: EditionSummary[]; current: string | null } {
  const me = useMe();
  // An edition closed, reopened or activated changes what the list offers.
  const { data } = useLiveQuery<MyEditionsResponse>(
    (signal) => api.get<MyEditionsResponse>("/api/me/editions", { signal }),
    domainScope(SSE_TOPICS.IDENTITY),
    [EVENTS.EDITION_CHANGED],
    { enabled: !!me, resourceKey: ["me", "editions"] },
  );
  return { editions: data?.editions ?? [], current: data?.current ?? null };
}

/** The key of the edition being viewed (`null` until one is picked: the current edition). */
export function useViewedEditionKey(): string | null {
  return useSyncExternalStore(subscribeViewedEdition, getViewedEdition, () => null);
}

/** The edition the session facts are scoped to, or null while unknown. */
export function useViewedEdition(): Pick<EditionSummary, "eventKey" | "name" | "status"> | null {
  const me = useMe();
  const { editions, current } = useEditions();
  const viewed = useViewedEditionKey();
  if (me?.edition && (viewed === null || me.edition.eventKey === viewed)) return me.edition;
  const key = viewed ?? current;
  return editions.find((edition) => edition.eventKey === key) ?? null;
}
