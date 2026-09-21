"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS } from "@hackos/shared/events";
import { GlobeIcon, MonitorUpIcon, RadioIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessDenied } from "@/components/common/access-denied";
import { ContextualError } from "@/components/common/contextual-error";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { StatusBadge } from "@/components/common/status-badge";
import { SubmitButton } from "@/components/common/submit-button";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useEventSource } from "@/hooks/use-event-source";
import { ApiError } from "@/lib/api";
import { formatScheduledDateTime } from "@/lib/datetime";
import { isLanguage, languageName, useLocale } from "@/lib/i18n";
import { useCan } from "@/lib/session";
import { toast } from "@/lib/toast";
import {
  clearTvMode,
  DEFAULT_LIVE_CONFIG,
  getTvState,
  getTvVenueConfig,
  type LiveScreenConfig,
  liveConfigFrom,
  setTvLanguage,
  setTvMode,
  TV_CONTROL_MODES,
  type TvControlMode,
  type TvState,
} from "@/lib/tv";
import type { Language } from "@/lib/types";
import { LiveModePreview } from "./live-preview";
import { LiveSettings } from "./live-settings";

function buildModes(
  t: ReturnType<typeof useLocale>["t"],
): Array<{ value: TvControlMode; label: string; detail: string }> {
  return [
    { value: "live", label: t("modeLive"), detail: t("modeLiveDetail") },
    { value: "rooms", label: t("modeRooms"), detail: t("modeRoomsDetail") },
    { value: "schedule", label: t("schedule"), detail: t("modeScheduleDetail") },
    { value: "sponsors", label: t("sponsors"), detail: t("modeSponsorsDetail") },
    { value: "wifi", label: t("modeWifi"), detail: t("modeWifiDetail") },
  ];
}

function isTvControlMode(mode: string): mode is TvControlMode {
  return (TV_CONTROL_MODES as readonly string[]).includes(mode);
}

export default function TvControlPage() {
  const { t } = useLocale();
  const MODES = useMemo(() => buildModes(t), [t]);
  const canControl = useCan(CAPABILITIES.TV_CONTROL);
  const [current, setCurrent] = useState<TvState | null>(null);
  const [mode, setMode] = useState<TvControlMode>("live");
  const [liveConfig, setLiveConfig] = useState<LiveScreenConfig>(DEFAULT_LIVE_CONFIG);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tvLanguage, setTvLanguageState] = useState<Language | null>(null);
  const [languageBusy, setLanguageBusy] = useState(false);
  const initializedRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const [next, venue] = await Promise.all([getTvState(), getTvVenueConfig()]);
      setCurrent(next);
      setTvLanguageState(venue.language);
      setLoadError(null);
      // Only seed the draft from reality on first load — later operator updates
      // must not clobber an in-progress edit.
      if (!initializedRef.current) {
        initializedRef.current = true;
        if (isTvControlMode(next.mode)) setMode(next.mode);
        if (next.mode === "live") setLiveConfig(liveConfigFrom(next.payload));
      }
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t("couldNotLoadTvMode");
      // A background refresh failure (SSE hiccup) still has data on screen and
      // just toasts; only a failed *initial* load blocks the region. Checking
      // the ref (not `current`, which would make `load` itself unstable and
      // re-trigger the effect that calls it) keeps this a one-shot decision.
      if (!initializedRef.current) setLoadError(message);
      else toast.error(message);
    }
  }, [t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (canControl) void load();
  }, [canControl, load]);

  // Authenticated TV stream keeps every operator's control page in sync. The
  // public wall gets the same invalidation through its payload-free mirror.
  const { connected } = useEventSource("/api/events/stream?topic=tv", {
    events: [EVENTS.TV_MODE_CHANGED, EVENTS.TV_CONFIG_CHANGED],
    onEvent: () => {
      void load();
    },
    enabled: canControl,
  });

  async function changeTvLanguage(next: Language | null) {
    setLanguageBusy(true);
    try {
      const venue = await setTvLanguage(next);
      setTvLanguageState(venue.language);
      toast.success(t("tvLanguageUpdated"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotUpdateTvLanguage"));
    } finally {
      setLanguageBusy(false);
    }
  }

  async function broadcast() {
    const payload = mode === "live" ? liveConfig : null;
    setBusy(true);
    try {
      const next = await setTvMode(mode, payload);
      setCurrent(next);
      toast.success(t("tvDisplaysUpdated"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotUpdateTvDisplays"));
    } finally {
      setBusy(false);
    }
  }

  function requestBroadcast() {
    void broadcast();
  }

  async function resetToRooms() {
    setBusy(true);
    try {
      const next = await clearTvMode();
      setCurrent(next);
      if (isTvControlMode(next.mode)) setMode(next.mode);
      toast.success(t("tvDisplayReset"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotUpdateTvDisplays"));
    } finally {
      setBusy(false);
    }
  }

  if (!canControl) return <AccessDenied ask={t("tvControlDeniedDesc")} />;

  const currentModeLabel = current
    ? (MODES.find((item) => item.value === current.mode)?.label ?? current.mode)
    : null;
  // A "live" draft can drift from the broadcast payload without the mode
  // itself changing (an operator hides a block, retargets the timer, …) — the
  // comparison has to reach into the payload, not just the mode name, or the
  // page silently looks up to date while an edited draft sits unpublished.
  const isDraftUnbroadcast = current
    ? current.mode !== mode ||
      (mode === "live" &&
        JSON.stringify(liveConfig) !== JSON.stringify(liveConfigFrom(current.payload)))
    : false;
  const isManuallySelected = current?.source === "manual";

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("tvControl")}
        description={t("tvControlDesc")}
        primaryAction={
          <Button size="sm" variant="outline" asChild>
            <a href="/tv" target="_blank" rel="noreferrer">
              {t("openTvDisplay")}
            </a>
          </Button>
        }
      />

      <SectionCard
        icon={RadioIcon}
        title={t("currentBroadcast")}
        description={
          current
            ? t("currentlyShowing", { mode: currentModeLabel ?? current.mode })
            : t("loadingCurrentMode")
        }
        action={
          isManuallySelected ? (
            <Button variant="outline" disabled={busy} onClick={() => void resetToRooms()}>
              {t("resetTvDisplay")}
            </Button>
          ) : undefined
        }
      >
        {loadError && !current ? (
          <ContextualError message={loadError} onRetry={() => void load()} />
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
            <div className="aspect-video w-full overflow-hidden rounded-lg border bg-black">
              <iframe
                src="/tv"
                title={t("liveTvPreview")}
                className="h-full w-full"
                // The public TV page has no interactive controls; this is a read-only mirror.
                sandbox="allow-scripts allow-same-origin"
              />
            </div>
            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-2">
                <span
                  className={`size-2 rounded-full ${connected ? "bg-success" : "bg-destructive"}`}
                  aria-hidden="true"
                />
                <span className="text-muted-foreground">
                  {connected ? t("tvFeedConnected") : t("tvFeedReconnecting")}
                </span>
              </div>
              <div>
                {current?.source === "manual" && (
                  <StatusBadge tone="success">{t("sourceManual")}</StatusBadge>
                )}
                {current?.source === "default" && (
                  <StatusBadge tone="neutral">{t("sourceDefault")}</StatusBadge>
                )}
              </div>
              {current?.broadcastAt && current.source === "manual" && (
                <p className="text-muted-foreground">
                  {t("lastBroadcastAt", { time: formatScheduledDateTime(current.broadcastAt) })}
                </p>
              )}
            </div>
          </div>
        )}
      </SectionCard>

      <SectionCard
        icon={MonitorUpIcon}
        title={t("displayMode")}
        description={isDraftUnbroadcast ? t("draftNotYetBroadcastDesc") : t("draftMatchesLiveDesc")}
        footer={
          <div className="flex items-center gap-3">
            {isDraftUnbroadcast && <StatusBadge tone="warning">{t("dataStatusDraft")}</StatusBadge>}
            <SubmitButton pending={busy} onClick={requestBroadcast}>
              {t("showOnTvs")}
            </SubmitButton>
          </div>
        }
      >
        <fieldset>
          <legend className="mb-3 text-sm font-medium">{t("chooseAMode")}</legend>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {MODES.map((item) => (
              <label
                key={item.value}
                className="has-checked:border-primary has-checked:bg-muted flex cursor-pointer gap-3 rounded-lg border p-4"
              >
                <input
                  className="mt-1"
                  type="radio"
                  name="tv-mode"
                  value={item.value}
                  checked={mode === item.value}
                  onChange={() => setMode(item.value)}
                />
                <span>
                  <span className="block font-medium">{item.label}</span>
                  <span className="text-muted-foreground mt-1 block text-sm">{item.detail}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        {mode === "live" && (
          <div className="grid gap-4 pt-2 lg:grid-cols-[minmax(0,1fr)_320px]">
            <LiveSettings value={liveConfig} onChange={setLiveConfig} />
            <LiveModePreview config={liveConfig} />
          </div>
        )}
      </SectionCard>

      <SectionCard
        icon={GlobeIcon}
        title={t("tvDisplayLanguage")}
        description={t("tvDisplayLanguageDesc")}
      >
        <div className="grid gap-2 sm:max-w-xs">
          <Select
            value={tvLanguage ?? "default"}
            disabled={languageBusy}
            onValueChange={(value) =>
              void changeTvLanguage(value === "default" ? null : isLanguage(value) ? value : null)
            }
          >
            <SelectTrigger aria-label={t("tvDisplayLanguage")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">{t("tvDisplayLanguageDefault")}</SelectItem>
              {(["es", "gl", "en"] as const).map((item) => (
                <SelectItem key={item} value={item}>
                  {languageName(item)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </SectionCard>
    </div>
  );
}
