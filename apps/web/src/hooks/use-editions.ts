"use client";

import type { EditionSummary, MyEditionsResponse } from "@hackos/shared/editions";
import { useSyncExternalStore } from "react";
import { api } from "@/lib/api";
import { useMe } from "@/lib/session";
import { getViewedEdition, subscribeViewedEdition } from "@/lib/viewed-edition";
import { useServerResource } from "./use-server-resource";

/** Editions the signed-in user can view, newest first, and the current one's key. */
export function useEditions(): { editions: EditionSummary[]; current: string | null } {
  const me = useMe();
  const { data } = useServerResource<MyEditionsResponse>(
    ["me", "editions"],
    (signal) => api.get<MyEditionsResponse>("/api/me/editions", { signal }),
    { enabled: !!me },
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
