"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS } from "@hackos/shared/events";
import { AlertTriangleIcon, MonitorUpIcon, RadioIcon, WifiIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AccessDenied } from "@/components/common/access-denied";
import { DateTimeInput } from "@/components/common/datetime-input";
import { Modal } from "@/components/common/modal";
import { PageHeader } from "@/components/common/page-header";
import { PasswordInput } from "@/components/common/password-input";
import { SectionCard } from "@/components/common/section-card";
import { StatusBadge } from "@/components/common/status-badge";
import { SubmitButton } from "@/components/common/submit-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
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
  type TvModeName,
  type TvState,
} from "@/lib/tv";
import { LiveSettings } from "./live-settings";
import { Timetable } from "./timetable";

function buildModes(
  t: ReturnType<typeof useLocale>["t"],
): Array<{ value: TvModeName; label: string; detail: string }> {
  return [
    { value: "live", label: t("modeLive"), detail: t("modeLiveDetail") },
    { value: "rooms", label: t("modeRooms"), detail: t("modeRoomsDetail") },
    { value: "schedule", label: t("schedule"), detail: t("modeScheduleDetail") },
    { value: "sponsors", label: t("sponsors"), detail: t("modeSponsorsDetail") },
    { value: "announcement", label: t("modeAnnouncement"), detail: t("modeAnnouncementDetail") },
    { value: "wifi", label: t("modeWifi"), detail: t("modeWifiDetail") },
    { value: "timer", label: t("modeTimer"), detail: t("modeTimerDetail") },
  ];
}

const EXPIRY_OPTIONS = ["none", "15", "30", "60"] as const;
type ExpiryOption = (typeof EXPIRY_OPTIONS)[number];

/** Modes that take over every screen and deserve an automatic expiry + a confirmation step (H42). */
const SENSITIVE_MODES: TvModeName[] = ["announcement", "wifi"];
const EXPIRABLE_MODES: TvModeName[] = ["announcement", "wifi", "timer"];

export default function TvControlPage() {
  const { t } = useLocale();
  const MODES = useMemo(() => buildModes(t), [t]);
  const canControl = useCan(CAPABILITIES.TV_CONTROL);
  const [current, setCurrent] = useState<TvState | null>(null);
  const [mode, setMode] = useState<TvModeName>("live");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [ssid, setSsid] = useState("");
  const [password, setPassword] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [liveConfig, setLiveConfig] = useState<LiveScreenConfig>(DEFAULT_LIVE_CONFIG);
  const [expiryOption, setExpiryOption] = useState<ExpiryOption>("none");
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [timetableKey, setTimetableKey] = useState(0);
  const initializedRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const next = await getTvState();
      setCurrent(next);
      // Only seed the draft from reality on first load — later live updates
      // (another admin changing the mode, or a timetable slot taking over)
      // must not clobber an in-progress edit.
      if (!initializedRef.current) {
        initializedRef.current = true;
        setMode(next.mode);
        if (next.mode === "live") setLiveConfig(liveConfigFrom(next.payload));
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotLoadTvMode"));
    }
  }, [t]);

  useEffect(() => {
    if (canControl) void load();
  }, [canControl, load]);

  // Reflects the actual delivery pathway to the fleet: if this drops, the TV
  // wall isn't receiving live changes either (they share the same SSE topic).
  const { connected } = useEventSource("/api/tv/stream", {
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
    const payload =
      mode === "announcement"
        ? { title: title.trim() || undefined, body: body.trim() || undefined }
        : mode === "wifi"
          ? { ssid: ssid.trim(), password: password.trim() || undefined }
          : mode === "timer"
            ? {
                label: title.trim() || undefined,
                endsAt: endsAt ? new Date(endsAt).toISOString() : undefined,
              }
            : mode === "live"
              ? liveConfig
              : null;
    const expiresAt = EXPIRABLE_MODES.includes(mode) ? expiresAtFor(expiryOption) : null;
    setBusy(true);
    try {
      const next = await setTvMode(mode, payload, expiresAt);
      setCurrent(next);
      setConfirmOpen(false);
      toast.success(t("tvDisplaysUpdated"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotUpdateTvDisplays"));
    } finally {
      setBusy(false);
    }
  }

  function requestBroadcast() {
    if (SENSITIVE_MODES.includes(mode)) {
      setConfirmOpen(true);
      return;
    }
    void broadcast();
  }

  async function backToSchedule() {
    setBusy(true);
    try {
      const next = await clearTvOverride();
      setCurrent(next);
      setMode(next.mode);
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
  const isDraftUnbroadcast = current ? current.mode !== mode : false;
  const isOverridden = current?.source === "override";

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("tvControl")}
        description={t("tvControlDesc")}
        actions={
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
      </SectionCard>

      <SectionCard
        icon={MonitorUpIcon}
        title={t("displayMode")}
        description={isDraftUnbroadcast ? t("draftNotYetBroadcastDesc") : t("draftMatchesLiveDesc")}
        footer={
          <div className="flex items-center gap-3">
            {isDraftUnbroadcast && <StatusBadge tone="warning">{t("statusDraft")}</StatusBadge>}
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
                className="has-[:checked]:border-primary has-[:checked]:bg-muted flex cursor-pointer gap-3 rounded-lg border p-4"
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
          <div className="pt-2">
            <LiveSettings value={liveConfig} onChange={setLiveConfig} />
          </div>
        )}
        {mode === "announcement" && (
          <div className="grid gap-4 pt-2">
            <div className="grid gap-2">
              <Label htmlFor="announcement-title">{t("titleLabel")}</Label>
              <Input
                id="announcement-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={t("leaveBlankShowActive")}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="announcement-body">{t("messageLabel")}</Label>
              <Textarea
                id="announcement-body"
                value={body}
                onChange={(event) => setBody(event.target.value)}
                placeholder={t("optionalMessageEveryTv")}
              />
            </div>
          </div>
        )}
        {mode === "wifi" && (
          <div className="grid gap-4 pt-2 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="wifi-ssid">{t("networkNameLabel")}</Label>
              <Input
                id="wifi-ssid"
                value={ssid}
                onChange={(event) => setSsid(event.target.value)}
                placeholder={t("hackathonWifiPlaceholder")}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="wifi-password">{t("password")}</Label>
              <PasswordInput
                id="wifi-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            <p className="text-muted-foreground flex items-center gap-2 text-sm sm:col-span-2">
              <WifiIcon className="size-4" aria-hidden="true" />
              {t("wifiOverridesVenueHint")}
            </p>
          </div>
        )}
        {mode === "timer" && (
          <div className="grid gap-4 pt-2 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="timer-label">{t("timerLabelField")}</Label>
              <Input
                id="timer-label"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={t("timeRemaining")}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="timer-end">{t("customEndTime")}</Label>
              <DateTimeInput
                id="timer-end"
                value={endsAt}
                onChange={setEndsAt}
                nullOption={{ label: t("useEventEndTime") }}
              />
            </div>
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

      <Modal
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={mode === "wifi" ? t("confirmWifiBroadcastTitle") : t("confirmUrgentBroadcastTitle")}
        icon={AlertTriangleIcon}
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              {t("cancel")}
            </Button>
            <SubmitButton pending={busy} onClick={broadcast}>
              {t("broadcastNow")}
            </SubmitButton>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-muted-foreground text-sm">
            {mode === "wifi" ? t("confirmWifiBroadcastDesc") : t("confirmUrgentBroadcastDesc")}
          </p>
          <div className="rounded-lg border p-4">
            {mode === "wifi" ? (
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                <dt className="text-muted-foreground">{t("networkNameLabel")}</dt>
                <dd className="font-mono">{ssid || "—"}</dd>
                <dt className="text-muted-foreground">{t("password")}</dt>
                <dd className="font-mono">{password || "—"}</dd>
              </dl>
            ) : (
              <div>
                <p className="font-semibold">{title || t("leaveBlankShowActive")}</p>
                {body && <p className="text-muted-foreground mt-1 text-sm">{body}</p>}
              </div>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}
