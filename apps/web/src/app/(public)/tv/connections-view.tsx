"use client";

import type { TvConnectionsResponse } from "@hackos/shared/tv-connections";
import { UsersThreeIcon } from "@phosphor-icons/react/dist/csr/UsersThree";
import { useCallback, useEffect, useRef, useState } from "react";
import { Spinner } from "@/components/common/spinner";
import type { PublicEvent } from "@/components/public/public-types";
import { useJitteredCallback } from "@/hooks/use-jittered-callback";
import { useLocale } from "@/lib/i18n";
import { getTvConnections } from "@/lib/tv";
import { ConnectionsGraph } from "./connections-graph";
import { TvBody, TvEmpty, TvHeader, TvScreen } from "./tv-screen";

/** Poll window; each cycle waits a random time inside it so screens drift apart. */
export const CONNECTIONS_POLL_MIN_MS = 15_000;
export const CONNECTIONS_POLL_MAX_MS = 30_000;
/** SSE invalidations spread over this window and never refetch more often than the floor. */
const INVALIDATION_JITTER_MS = 3_000;
const MIN_REFETCH_MS = 5_000;

/**
 * Full-screen attendee/company connections graph (#934, #935). Keeps the last
 * good snapshot when a poll fails, so an unattended wall never goes blank.
 * `invalidation` changes whenever the public TV stream signals a change.
 */
export function ConnectionsView({
  event,
  invalidation = 0,
}: {
  event: PublicEvent;
  invalidation?: number;
}) {
  const { t } = useLocale();
  const [data, setData] = useState<TvConnectionsResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const lastFetch = useRef(0);

  const load = useCallback(async () => {
    lastFetch.current = Date.now();
    try {
      const next = await getTvConnections();
      setData(next);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;
    const cycle = () => {
      const delay =
        CONNECTIONS_POLL_MIN_MS +
        Math.random() * (CONNECTIONS_POLL_MAX_MS - CONNECTIONS_POLL_MIN_MS);
      timer = setTimeout(async () => {
        await load();
        if (!cancelled) cycle();
      }, delay);
    };
    void load();
    cycle();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [load]);

  const refreshSoon = useJitteredCallback(() => {
    if (Date.now() - lastFetch.current >= MIN_REFETCH_MS) void load();
  }, INVALIDATION_JITTER_MS);
  const firstInvalidation = useRef(invalidation);
  useEffect(() => {
    if (invalidation !== firstInvalidation.current) refreshSoon();
  }, [invalidation, refreshSoon]);

  const empty = data !== null && data.nodes.length === 0;

  return (
    // Always the dark wall look: this view paints its own flat canvas, header included.
    <TvScreen className="dark bg-[#0b0c14] text-foreground">
      {() => (
        <>
          <TvHeader title={t("modeConnections")} icon={UsersThreeIcon} eventName={event.name} />
          <TvBody className="gap-[1em] p-[1.5em]">
            {!data ? (
              failed ? (
                <TvEmpty text={t("connectionsUnavailable")} />
              ) : (
                <div className="grid flex-1 place-items-center" role="status" aria-busy="true">
                  <Spinner className="size-10" />
                  <span className="sr-only">{t("loadingTvDisplay")}</span>
                </div>
              )
            ) : empty ? (
              <TvEmpty text={t("connectionsEmpty")} />
            ) : (
              <>
                <div className="min-h-0 flex-1">
                  <ConnectionsGraph
                    nodes={data.nodes}
                    edges={data.edges}
                    label={t("connectionsGraphLabel", {
                      people: data.totals.people,
                      companies: data.totals.companies,
                      connections: data.totals.connections,
                    })}
                  />
                </div>
                {(data.truncated || failed) && (
                  <p className="text-muted-foreground text-[1.1em]">
                    {failed ? t("tvReconnecting") : t("connectionsTruncated")}
                  </p>
                )}
              </>
            )}
          </TvBody>
        </>
      )}
    </TvScreen>
  );
}
