"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { MonitorUpIcon, WifiIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { SubmitButton } from "@/components/common/submit-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { getTvMode, setTvMode, type TvMode, type TvModeName } from "@/lib/queue";
import { useCan } from "@/lib/session";

function buildModes(
  t: ReturnType<typeof useLocale>["t"],
): Array<{ value: TvModeName; label: string; detail: string }> {
  return [
    { value: "rooms", label: t("modeRooms"), detail: t("modeRoomsDetail") },
    { value: "schedule", label: t("schedule"), detail: t("modeScheduleDetail") },
    { value: "sponsors", label: t("sponsors"), detail: t("modeSponsorsDetail") },
    { value: "announcement", label: t("modeAnnouncement"), detail: t("modeAnnouncementDetail") },
    { value: "wifi", label: t("modeWifi"), detail: t("modeWifiDetail") },
    { value: "timer", label: t("modeTimer"), detail: t("modeTimerDetail") },
  ];
}

export default function TvControlPage() {
  const { t } = useLocale();
  const MODES = useMemo(() => buildModes(t), [t]);
  const canControl = useCan(CAPABILITIES.TV_CONTROL);
  const [current, setCurrent] = useState<TvMode | null>(null);
  const [mode, setMode] = useState<TvModeName>("rooms");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [ssid, setSsid] = useState("");
  const [password, setPassword] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const next = await getTvMode();
      setCurrent(next);
      setMode(next.mode);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotLoadTvMode"));
    }
  }, [t]);
  useEffect(() => {
    if (canControl) void load();
  }, [canControl, load]);

  async function submit() {
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
            : null;
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
  if (!canControl)
    return (
      <div className="space-y-6">
        <PageHeader title={t("tvControl")} />
        <EmptyState
          icon={MonitorUpIcon}
          title={t("noAccessTvControl")}
          description={t("tvControlDeniedDesc")}
        />
      </div>
    );
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
        icon={MonitorUpIcon}
        title={t("displayMode")}
        description={
          current
            ? t("currentlyShowing", {
                mode: MODES.find((item) => item.value === current.mode)?.label ?? current.mode,
              })
            : t("loadingCurrentMode")
        }
        footer={
          <SubmitButton pending={busy} onClick={() => void submit()}>
            {t("showOnTvs")}
          </SubmitButton>
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
              <Input
                id="wifi-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            <p className="text-muted-foreground flex items-center gap-2 text-sm sm:col-span-2">
              <WifiIcon className="size-4" aria-hidden="true" />
              {t("networkDetailsVisible")}
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
              <Input
                id="timer-end"
                type="datetime-local"
                value={endsAt}
                onChange={(event) => setEndsAt(event.target.value)}
              />
              <p className="text-muted-foreground text-sm">{t("leaveBlankEventEndTime")}</p>
            </div>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
