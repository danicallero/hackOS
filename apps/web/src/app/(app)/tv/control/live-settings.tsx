"use client";

import { DateTimeInput } from "@/components/common/datetime-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { fromDatetimeLocal, toDatetimeLocal } from "@/lib/datetime";
import { useLocale } from "@/lib/i18n";
import type { LiveScreenConfig, TimerTarget } from "@/lib/tv";

/**
 * Editor for the combined live screen's blocks (H42). The same control edits
 * an operator broadcast and a timetable slot, because both carry the identical
 * payload — an organiser shouldn't have to learn two versions of the same
 * screen.
 */

const TIMER_TARGET_KEYS = {
  auto: "timerTargetAuto",
  hackingStartsAt: "timerTargetHackingStart",
  hackingEndsAt: "timerTargetHackingEnd",
  judgingStartsAt: "timerTargetJudgingStart",
  judgingEndsAt: "timerTargetJudgingEnd",
  custom: "timerTargetCustom",
} as const;

function BlockToggle({
  id,
  label,
  checked,
  onChange,
  children,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={id}>{label}</Label>
        <Switch id={id} checked={checked} onCheckedChange={onChange} />
      </div>
      {checked && children && <div className="mt-4 grid gap-3">{children}</div>}
    </div>
  );
}

export function LiveSettings({
  value,
  onChange,
  idPrefix = "live",
}: {
  value: LiveScreenConfig;
  onChange: (next: LiveScreenConfig) => void;
  idPrefix?: string;
}) {
  const { t } = useLocale();
  const id = (name: string) => `${idPrefix}-${name}`;

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <BlockToggle
        id={id("timer")}
        label={t("liveBlockTimer")}
        checked={value.timer.show}
        onChange={(show) => onChange({ ...value, timer: { ...value.timer, show } })}
      >
        <div className="grid gap-2">
          <Label htmlFor={id("timer-target")}>{t("timerTargetLabel")}</Label>
          <Select
            value={value.timer.target}
            onValueChange={(target) =>
              onChange({ ...value, timer: { ...value.timer, target: target as TimerTarget } })
            }
          >
            <SelectTrigger id={id("timer-target")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(TIMER_TARGET_KEYS).map(([target, key]) => (
                <SelectItem key={target} value={target}>
                  {t(key)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {value.timer.target === "custom" && (
          <div className="grid gap-2">
            <Label htmlFor={id("timer-end")}>{t("customEndTime")}</Label>
            <DateTimeInput
              id={id("timer-end")}
              value={toDatetimeLocal(value.timer.endsAt)}
              onChange={(next) =>
                onChange({
                  ...value,
                  timer: { ...value.timer, endsAt: next ? fromDatetimeLocal(next) : null },
                })
              }
            />
          </div>
        )}
        <div className="grid gap-2">
          <Label htmlFor={id("timer-label")}>{t("timerLabelField")}</Label>
          <Input
            id={id("timer-label")}
            value={value.timer.label ?? ""}
            placeholder={t("timeRemaining")}
            onChange={(event) =>
              onChange({
                ...value,
                timer: { ...value.timer, label: event.target.value || null },
              })
            }
          />
        </div>
      </BlockToggle>

      <BlockToggle
        id={id("schedule")}
        label={t("liveBlockSchedule")}
        checked={value.schedule.show}
        onChange={(show) => onChange({ ...value, schedule: { ...value.schedule, show } })}
      >
        <div className="grid gap-2">
          <Label htmlFor={id("schedule-rows")}>{t("liveScheduleRowsLabel")}</Label>
          <Input
            id={id("schedule-rows")}
            type="number"
            min={1}
            max={20}
            value={value.schedule.upcoming}
            onChange={(event) =>
              onChange({
                ...value,
                schedule: { ...value.schedule, upcoming: Number(event.target.value) || 1 },
              })
            }
          />
          <p className="text-muted-foreground text-sm">{t("liveScheduleRowsHint")}</p>
        </div>
      </BlockToggle>

      <BlockToggle
        id={id("sponsors")}
        label={t("liveBlockSponsors")}
        checked={value.sponsors.show}
        onChange={(show) => onChange({ ...value, sponsors: { show } })}
      />

      <BlockToggle
        id={id("wifi")}
        label={t("liveBlockWifi")}
        checked={value.wifi.show}
        onChange={(show) => onChange({ ...value, wifi: { ...value.wifi, show } })}
      >
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor={id("wifi-password")}>{t("liveWifiShowPassword")}</Label>
          <Switch
            id={id("wifi-password")}
            checked={value.wifi.showPassword}
            onCheckedChange={(showPassword) =>
              onChange({ ...value, wifi: { ...value.wifi, showPassword } })
            }
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor={id("wifi-qr")}>{t("liveWifiShowQr")}</Label>
          <Switch
            id={id("wifi-qr")}
            checked={value.wifi.showQr}
            onCheckedChange={(showQr) => onChange({ ...value, wifi: { ...value.wifi, showQr } })}
          />
        </div>
        <p className="text-muted-foreground text-sm">{t("liveWifiSourceHint")}</p>
      </BlockToggle>
    </div>
  );
}
