import type { EditionSummary, MyEditionsResponse } from "@hackos/shared/editions";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { apiFetch } from "./api";
import {
  commitEditionChange,
  getEditionEpoch,
  getViewedEdition,
  resetViewedEdition,
  selectViewedEdition,
  subscribeEdition,
} from "./edition";
import { setEventTimeZone } from "./event-time";
import { clearCachedValues } from "./offline-cache";
import { setServerEventIdentity } from "./server-events";
import { registerSignOutListener } from "./sign-out-events";
import type { Me } from "./types";
import { useMe } from "./use-me";

interface MeContextValue {
  me: Me | null;
  authenticated: boolean;
  loading: boolean;
  error: Error | null;
  /** True when `me` is being served from on-device cache because the last live fetch couldn't confirm the session. */
  offline: boolean;
  staleSince: string | null;
  offlineEntryAvailable: boolean;
  enterOffline: () => Promise<void>;
  refetch: () => Promise<Me | null>;
  clear: () => void;
  /** Editions the user can view, newest first; empty until loaded. */
  editions: EditionSummary[];
  /** Key of the edition being viewed; null is the current edition. */
  viewedEdition: string | null;
  /** View another edition (null = current); rejects, and stays put, when the server is unreachable. */
  switchEdition: (eventKey: string | null) => Promise<void>;
}

const MeContext = createContext<MeContextValue | null>(null);

interface MeActionsContextValue {
  refetch: () => Promise<Me | null>;
  clear: () => void;
}

const MeActionsContext = createContext<MeActionsContextValue | null>(null);

/** Wraps the authenticated part of the tree in a single shared /api/me fetch. */
export function MeProvider({ children }: { children: ReactNode }) {
  const base = useMe();
  const epoch = useSyncExternalStore(subscribeEdition, getEditionEpoch, getEditionEpoch);
  const [editions, setEditions] = useState<EditionSummary[]>([]);
  const meId = base.me?.id ?? null;
  const online = base.me !== null && !base.offline;
  // biome-ignore lint/correctness/useExhaustiveDependencies: epoch re-reads the list after a switch.
  useEffect(() => {
    if (!online) return;
    let active = true;
    apiFetch<MyEditionsResponse>("/api/me/editions")
      .then((response) => {
        if (active) setEditions(response.editions);
      })
      .catch(() => {
        // The selector simply stays hidden; every screen still works.
      });
    return () => {
      active = false;
    };
  }, [online, meId, epoch]);
  const { refetch } = base;
  const switchEdition = useCallback(
    async (eventKey: string | null) => {
      const previous = getViewedEdition();
      if (previous === eventKey) return;
      selectViewedEdition(eventKey);
      try {
        // Verify the target edition is reachable before dropping anything.
        await apiFetch<MyEditionsResponse>("/api/me/editions");
      } catch (error) {
        selectViewedEdition(previous);
        throw error;
      }
      // Cached reads belong to the previous edition.
      if (meId !== null) await clearCachedValues(`user:${meId}:`);
      await refetch();
      commitEditionChange();
    },
    [meId, refetch],
  );
  const viewedEdition = getViewedEdition();
  const value = useMemo(
    () => ({ ...base, editions, viewedEdition, switchEdition }),
    [base, editions, viewedEdition, switchEdition],
  );
  useLayoutEffect(() => {
    setServerEventIdentity(value.me?.id ?? null);
  }, [value.me?.id]);
  // H45/H47: every shown and typed time is the event's clock, not the phone's.
  useLayoutEffect(() => {
    setEventTimeZone(value.me?.eventTimezone ?? null);
  }, [value.me?.eventTimezone]);
  const actions = useMemo(
    () => ({ clear: value.clear, refetch: value.refetch }),
    [value.clear, value.refetch],
  );
  useEffect(
    () =>
      registerSignOutListener(() => {
        setServerEventIdentity(null);
        resetViewedEdition();
        value.clear();
      }),
    [value.clear],
  );
  return (
    <MeActionsContext.Provider value={actions}>
      <MeContext.Provider key={`${value.me?.id ?? "anonymous"}:${epoch}`} value={value}>
        {children}
      </MeContext.Provider>
    </MeActionsContext.Provider>
  );
}

export function useMeContext(): MeContextValue {
  const ctx = useContext(MeContext);
  if (!ctx) throw new Error("useMeContext must be used within MeProvider");
  return ctx;
}

/** Stable session actions for forms that must not re-render with profile data. */
export function useMeActions(): MeActionsContextValue {
  const ctx = useContext(MeActionsContext);
  if (!ctx) throw new Error("useMeActions must be used within MeProvider");
  return ctx;
}

/** Editions the user can view; empty outside the provider, so detail screens can ask unconditionally. */
export function useEditionList(): EditionSummary[] {
  return useContext(MeContext)?.editions ?? [];
}
