"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS } from "@hackos/shared/events";
import { MonitorUpIcon, RadioIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AccessDenied } from "@/components/common/access-denied";
import { ContextualError } from "@/components/common/contextual-error";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { StatusBadge } from "@/components/common/status-badge";
import { SubmitButton } from "@/components/common/submit-button";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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
import { useLocale } from "@/lib/i18n";
import { useCan } from "@/lib/session";
import {
  clearTvOverride,
  DEFAULT_LIVE_CONFIG,
  getTvState,
  type LiveScreenConfig,
  liveConfigFrom,
  setTvMode,
  TV_CONTROL_MODES,
  type TvControlMode,
  type TvState,
} from "@/lib/tv";
import { LiveModePreview } from "./live-preview";
import { LiveSettings } from "./live-settings";
import { Timetable } from "./timetable";

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

type ExpiryOption = "none" | "15" | "30" | "60";

const EXPIRABLE_MODES: TvControlMode[] = ["wifi"];

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
  const [expiryOption, setExpiryOption] = useState<ExpiryOption>("none");
  const [busy, setBusy] = useState(false);
  const [timetableKey, setTimetableKey] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const initializedRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const next = await getTvState();
      setCurrent(next);
      setLoadError(null);
      // Only seed the draft from reality on first load — later live updates
      // (another admin changing the mode, or a timetable slot taking over)
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

  // Authenticated tv-topic stream so this page (and other operators watching
  // it) picks up mode/timetable changes broadcast by anyone, not just this
  // tab's own PATCH response. The public wall gets the same broadcast via its
  // own payload-free /api/tv/stream mirror.
  const { connected } = useEventSource("/api/events/stream?topic=tv", {
    events: [EVENTS.TV_MODE_CHANGED, EVENTS.TV_SCHEDULE_CHANGED],
    onEvent: (event) => {
      void load();
      if (event.type === EVENTS.TV_SCHEDULE_CHANGED) setTimetableKey((key) => key + 1);
    },
    enabled: canControl,
  });

  function expiresAtFor(option: ExpiryOption): string | null {
    if (option === "none") return null;
    return new Date(Date.now() + Number(option) * 60_000).toISOString();
  }

  async function broadcast() {
    const payload = mode === "live" ? liveConfig : null;
    const expiresAt = EXPIRABLE_MODES.includes(mode) ? expiresAtFor(expiryOption) : null;
    setBusy(true);
    try {
      const next = await setTvMode(mode, payload, expiresAt);
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

  async function backToSchedule() {
    setBusy(true);
    try {
      const next = await clearTvOverride();
      setCurrent(next);
      if (isTvControlMode(next.mode)) setMode(next.mode);
      toast.success(t("backOnTimetable"));
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
  const isOverridden = current?.source === "override";

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("tvControl")}
        description={t("tvControlDesc")}
        primaryAction={
          <Button variant="outline" asChild>
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
          isOverridden ? (
            <Button variant="outline" disabled={busy} onClick={() => void backToSchedule()}>
              {t("backToSchedule")}
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
              {/* Why the screens show what they show: an operator broadcast, the
                timetable, or neither. */}
              <div>
                {current?.source === "override" && (
                  <StatusBadge tone="warning">{t("sourceOverride")}</StatusBadge>
                )}
                {current?.source === "slot" && (
                  <StatusBadge tone="success">
                    {current.slot?.label
                      ? t("sourceSlotNamed", { label: current.slot.label })
                      : t("sourceSlot")}
                  </StatusBadge>
                )}
                {current?.source === "default" && (
                  <StatusBadge tone="neutral">{t("sourceDefault")}</StatusBadge>
                )}
              </div>
              {current?.slot && current.source === "slot" && (
                <p className="text-muted-foreground">
                  {t("slotEndsAt", { time: formatScheduledDateTime(current.slot.endsAt) })}
                </p>
              )}
              {current?.broadcastAt && current.source === "override" && (
                <p className="text-muted-foreground">
                  {t("lastBroadcastAt", { time: formatScheduledDateTime(current.broadcastAt) })}
                </p>
              )}
              {current?.source === "override" && (
                <p className="text-muted-foreground">
                  {current.expiresAt
                    ? t("autoRevertsAt", { time: formatScheduledDateTime(current.expiresAt) })
                    : t("noAutoRevert")}
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
        {EXPIRABLE_MODES.includes(mode) && (
          <div className="grid gap-2 pt-2 sm:max-w-xs">
            <Label htmlFor="expiry-option">{t("autoRevertLabel")}</Label>
            <Select
              value={expiryOption}
              onValueChange={(value) => setExpiryOption(value as ExpiryOption)}
            >
              <SelectTrigger id="expiry-option">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("autoRevertNone")}</SelectItem>
                <SelectItem value="15">{t("autoRevertMinutes", { count: 15 })}</SelectItem>
                <SelectItem value="30">{t("autoRevertMinutes", { count: 30 })}</SelectItem>
                <SelectItem value="60">{t("autoRevertMinutes", { count: 60 })}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-sm">{t("autoRevertHint")}</p>
          </div>
        )}
      </SectionCard>

      {/* Remounted (not just refetched) when another admin edits the
          timetable, so an open editor never sits on a stale slot. */}
      <Timetable key={timetableKey} modes={MODES} onChanged={load} />
    </div>
  );
}
