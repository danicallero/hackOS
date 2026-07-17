"use client";

// Shared GET /api/event fetch so every settings category starts from the same
// snapshot without six duplicate requests, while each category still owns its
// own PUT (the API accepts partial bodies — fields it omits are left
// unchanged, so one category's save can never clobber another's edits).

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { toast } from "sonner";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import type { EventConfig } from "@/lib/types";

interface EventConfigContextValue {
  config: EventConfig | null;
  status: "loading" | "ready" | "error";
  /** Merges a freshly-saved config into shared state so other tabs' previews stay current. */
  applyConfig: (next: EventConfig) => void;
}

const EventConfigContext = createContext<EventConfigContextValue | null>(null);

export function EventConfigProvider({ children }: { children: React.ReactNode }) {
  const { t } = useLocale();
  const [config, setConfig] = useState<EventConfig | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let active = true;
    api
      .get<EventConfig>("/api/event")
      .then((cfg) => {
        if (!active) return;
        setConfig(cfg);
        setStatus("ready");
      })
      .catch((err) => {
        if (!active) return;
        toast.error(err instanceof ApiError ? err.message : t("couldNotLoadEventSettings"));
        setStatus("error");
      });
    return () => {
      active = false;
    };
  }, [t]);

  const applyConfig = useCallback((next: EventConfig) => setConfig(next), []);

  return (
    <EventConfigContext.Provider value={{ config, status, applyConfig }}>
      {children}
    </EventConfigContext.Provider>
  );
}

export function useEventConfig(): EventConfigContextValue {
  const ctx = useContext(EventConfigContext);
  if (!ctx) throw new Error("useEventConfig must be used within EventConfigProvider");
  return ctx;
}
