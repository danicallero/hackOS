"use client";

// Shared GET /api/event fetch so every settings category starts from the same
// snapshot without six duplicate requests, while each category still owns its
// own PUT (the API accepts partial bodies — fields it omits are left
// unchanged, so one category's save can never clobber another's edits).

import type { LucideIcon } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { ContextualError } from "@/components/common/contextual-error";
import { SectionCard } from "@/components/common/section-card";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import type { EventConfig } from "@/lib/types";

interface EventConfigContextValue {
  config: EventConfig | null;
  status: "loading" | "ready" | "error";
  error: string | null;
  retry: () => void;
  /** Merges a freshly-saved config into shared state so other tabs' previews stay current. */
  applyConfig: (next: EventConfig) => void;
}

const EventConfigContext = createContext<EventConfigContextValue | null>(null);

export function EventConfigProvider({ children }: { children: React.ReactNode }) {
  const { t } = useLocale();
  const [config, setConfig] = useState<EventConfig | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(false);
  const requestIdRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setStatus("loading");
    setError(null);
    try {
      const cfg = await api.get<EventConfig>("/api/event");
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      setConfig(cfg);
      setStatus("ready");
    } catch (err) {
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      setError(err instanceof ApiError ? err.message : t("couldNotLoadEventSettings"));
      setStatus("error");
    }
  }, [t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Fetching event config from API is a legitimate external-system sync on mount.
    void load();
  }, [load]);

  const applyConfig = useCallback((next: EventConfig) => setConfig(next), []);
  const retry = useCallback(() => void load(), [load]);

  return (
    <EventConfigContext.Provider value={{ config, status, error, retry, applyConfig }}>
      {children}
    </EventConfigContext.Provider>
  );
}

export function useEventConfig(): EventConfigContextValue {
  const ctx = useContext(EventConfigContext);
  if (!ctx) throw new Error("useEventConfig must be used within EventConfigProvider");
  return ctx;
}

/**
 * Keeps H48 schedule and H28 wallet settings actionable while their shared
 * event snapshot is loading or unavailable instead of rendering blank tabs.
 */
export function EventConfigLoadState({ icon, title }: { icon: LucideIcon; title: string }) {
  const { t } = useLocale();
  const { status, error, retry } = useEventConfig();

  if (status === "ready") return null;

  return (
    <SectionCard icon={icon} title={title}>
      {status === "error" ? (
        <ContextualError message={error ?? t("couldNotLoadEventSettings")} onRetry={retry} />
      ) : (
        <div className="space-y-4" role="status" aria-busy="true" aria-label={t("loading")}>
          <Skeleton className="h-[var(--control-height-default)] w-full" />
          <Skeleton className="h-[var(--control-height-default)] w-full" />
          <Skeleton className="h-[var(--control-height-default)] w-2/3" />
        </div>
      )}
    </SectionCard>
  );
}
