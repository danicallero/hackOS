"use client";

import { CalendarClockIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertModal } from "@/components/common/alert-modal";
import { ContextualError } from "@/components/common/contextual-error";
import { DateTimeInput } from "@/components/common/datetime-input";
import { EmptyState } from "@/components/common/empty-state";
import { Modal } from "@/components/common/modal";
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
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api";
import { formatScheduledDateTime, fromDatetimeLocal, toDatetimeLocal } from "@/lib/datetime";
import { useLocale } from "@/lib/i18n";
import {
  createTvSlot,
  DEFAULT_LIVE_CONFIG,
  DEFAULT_ROTATION_SECONDS,
  deleteTvSlot,
  listTvSlots,
  liveConfigFrom,
  TV_CONTROL_MODES,
  type TvControlMode,
  type TvModeName,
  type TvSlot,
  updateTvSlot,
} from "@/lib/tv";
import { LiveSettings } from "./live-settings";

/**
 * The TV timetable (H42): absolute windows saying what the venue screens show
 * when, so the fleet follows the event without an operator at the keyboard.
 * Overlaps are legal — the latest-starting slot wins — which is what lets a
 * short ceremony window sit inside an all-day one.
 */

type DraftItem = { mode: TvControlMode; payload: unknown; seconds: number | null };
type Draft = {
  id: number | null;
  label: string;
  startsAt: string;
  endsAt: string;
  items: DraftItem[];
};

function emptyDraft(): Draft {
  const now = new Date();
  const inTwoHours = new Date(now.getTime() + 2 * 60 * 60_000);
  return {
    id: null,
    label: "",
    startsAt: toDatetimeLocal(now.toISOString()),
    endsAt: toDatetimeLocal(inTwoHours.toISOString()),
    items: [{ mode: "live", payload: DEFAULT_LIVE_CONFIG, seconds: null }],
  };
}

function draftFrom(slot: TvSlot): Draft {
  const items = slot.items
    .filter((item) => (TV_CONTROL_MODES as readonly TvModeName[]).includes(item.mode))
    .map((item) => ({
      mode: item.mode as TvControlMode,
      payload: item.payload,
      seconds: item.seconds,
    }));
  return {
    id: slot.id,
    label: slot.label ?? "",
    startsAt: toDatetimeLocal(slot.startsAt),
    endsAt: toDatetimeLocal(slot.endsAt),
    items: items.length ? items : [{ mode: "live", payload: DEFAULT_LIVE_CONFIG, seconds: null }],
  };
}

function isRunning(slot: TvSlot, now: number) {
  return new Date(slot.startsAt).getTime() <= now && new Date(slot.endsAt).getTime() > now;
}

export function Timetable({
  modes,
  onChanged,
}: {
  modes: Array<{ value: TvControlMode; label: string; detail?: string }>;
  onChanged: () => void;
}) {
  const { t } = useLocale();
  const [slots, setSlots] = useState<TvSlot[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const hasLoadedRef = useRef(false);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const load = useCallback(async () => {
    try {
      const { items } = await listTvSlots();
      setSlots(items);
      setLoadError(null);
      hasLoadedRef.current = true;
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t("couldNotLoadTvTimetable");
      // Same rule as the parent page: a background refresh failure still has
      // a list on screen and just toasts; a failed first load blocks the
      // region instead of rendering a silently-empty list.
      if (!hasLoadedRef.current) setLoadError(message);
      else toast.error(message);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (!draft) return;
    const startsAt = fromDatetimeLocal(draft.startsAt);
    const endsAt = fromDatetimeLocal(draft.endsAt);
    if (!startsAt || !endsAt) {
      toast.error(t("slotWindowRequired"));
      return;
    }
    const body = {
      label: draft.label.trim() || null,
      startsAt,
      endsAt,
      items: draft.items.map((item) => ({
        mode: item.mode,
        payload: item.payload ?? null,
        // A dwell only means anything while the slot rotates.
        seconds: draft.items.length > 1 ? (item.seconds ?? DEFAULT_ROTATION_SECONDS) : null,
      })),
    };
    setBusy(true);
    try {
      if (draft.id === null) await createTvSlot(body);
      else await updateTvSlot(draft.id, body);
      setDraft(null);
      await load();
      onChanged();
      toast.success(t("tvTimetableSaved"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotSaveTvSlot"));
    } finally {
      setBusy(false);
    }
  }

  async function remove(slot: TvSlot) {
    setBusy(true);
    try {
      await deleteTvSlot(slot.id);
      await load();
      onChanged();
      toast.success(t("tvSlotDeleted"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotDeleteTvSlot"));
    } finally {
      setBusy(false);
    }
  }

  const modeLabel = (mode: TvModeName) => modes.find((item) => item.value === mode)?.label ?? mode;

  return (
    <>
      <SectionCard
        icon={CalendarClockIcon}
        title={t("tvTimetable")}
        description={t("tvTimetableDesc")}
        action={
          <Button variant="outline" onClick={() => setDraft(emptyDraft())}>
            <PlusIcon aria-hidden="true" />
            {t("addSlot")}
          </Button>
        }
      >
        {loadError && !slots ? (
          <ContextualError message={loadError} onRetry={() => void load()} />
        ) : slots === null ? (
          <div className="space-y-3 py-1">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : slots.length === 0 ? (
          <EmptyState
            icon={CalendarClockIcon}
            title={t("tvTimetableEmptyTitle")}
            description={t("tvTimetableEmptyDesc")}
          />
        ) : (
          <ul className="divide-y">
            {slots.map((slot) => (
              <li key={slot.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">
                      {slot.label || slot.items.map((item) => modeLabel(item.mode)).join(" · ")}
                    </span>
                    {isRunning(slot, now) && (
                      <StatusBadge tone="success">{t("slotRunningNow")}</StatusBadge>
                    )}
                    {slot.items.length > 1 && (
                      <StatusBadge tone="neutral">
                        {t("slotRotating", { count: slot.items.length })}
                      </StatusBadge>
                    )}
                  </div>
                  <p className="text-muted-foreground text-sm">
                    {t("slotWindow", {
                      start: formatScheduledDateTime(slot.startsAt),
                      end: formatScheduledDateTime(slot.endsAt),
                    })}
                    {" · "}
                    {slot.items.map((item) => modeLabel(item.mode)).join(" → ")}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => setDraft(draftFrom(slot))}>
                    {t("edit")}
                  </Button>
                  <AlertModal
                    title={t("deleteSlotConfirmTitle")}
                    description={t("deleteSlotConfirmDesc")}
                    cancelLabel={t("cancel")}
                    confirmLabel={t("deleteSlot")}
                    destructive
                    pending={busy}
                    trigger={
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        aria-label={t("deleteSlot")}
                      >
                        <Trash2Icon aria-hidden="true" />
                      </Button>
                    }
                    onConfirm={() => void remove(slot)}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <Modal
        open={draft !== null}
        onOpenChange={(open) => !open && setDraft(null)}
        title={draft?.id === null ? t("addSlot") : t("editSlot")}
        description={t("slotOverlapHint")}
        icon={CalendarClockIcon}
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setDraft(null)}>
              {t("cancel")}
            </Button>
            <SubmitButton pending={busy} onClick={save}>
              {t("save")}
            </SubmitButton>
          </>
        }
      >
        {draft && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="grid gap-2">
                <Label htmlFor="slot-label">{t("slotLabel")}</Label>
                <Input
                  id="slot-label"
                  value={draft.label}
                  placeholder={t("slotLabelPlaceholder")}
                  onChange={(event) => setDraft({ ...draft, label: event.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="slot-start">{t("colStarts")}</Label>
                <DateTimeInput
                  id="slot-start"
                  value={draft.startsAt}
                  onChange={(startsAt) => setDraft({ ...draft, startsAt })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="slot-end">{t("endsLabel")}</Label>
                <DateTimeInput
                  id="slot-end"
                  value={draft.endsAt}
                  onChange={(endsAt) => setDraft({ ...draft, endsAt })}
                />
              </div>
            </div>

            <fieldset className="space-y-3">
              <legend className="text-sm font-medium">{t("slotContent")}</legend>
              <p className="text-muted-foreground text-sm">{t("slotRotationHint")}</p>
              {draft.items.map((item, index) => (
                <div
                  // Slot items are positional and have no id of their own.
                  // biome-ignore lint/suspicious/noArrayIndexKey: position is the identity here
                  key={index}
                  className="space-y-3 rounded-lg border p-4"
                >
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="grid flex-1 gap-2">
                      <Label htmlFor={`slot-item-${index}-mode`}>{t("displayMode")}</Label>
                      <Select
                        value={item.mode}
                        onValueChange={(mode) => {
                          const items = [...draft.items];
                          items[index] = {
                            ...item,
                            mode: mode as TvControlMode,
                            payload: mode === "live" ? (item.payload ?? DEFAULT_LIVE_CONFIG) : null,
                          };
                          setDraft({ ...draft, items });
                        }}
                      >
                        <SelectTrigger id={`slot-item-${index}-mode`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {modes.map((mode) => (
                            <SelectItem key={mode.value} value={mode.value}>
                              {mode.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {modes.find((m) => m.value === item.mode)?.detail && (
                        <p className="text-muted-foreground text-sm">
                          {modes.find((m) => m.value === item.mode)?.detail}
                        </p>
                      )}
                    </div>
                    {draft.items.length > 1 && (
                      <>
                        <div className="grid w-32 gap-2">
                          <Label htmlFor={`slot-item-${index}-seconds`}>{t("dwellSeconds")}</Label>
                          <Input
                            id={`slot-item-${index}-seconds`}
                            type="number"
                            min={5}
                            max={3600}
                            value={item.seconds ?? DEFAULT_ROTATION_SECONDS}
                            onChange={(event) => {
                              const items = [...draft.items];
                              items[index] = { ...item, seconds: Number(event.target.value) || 5 };
                              setDraft({ ...draft, items });
                            }}
                          />
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={t("removeFromRotation")}
                          onClick={() =>
                            setDraft({
                              ...draft,
                              items: draft.items.filter((_, i) => i !== index),
                            })
                          }
                        >
                          <Trash2Icon aria-hidden="true" />
                        </Button>
                      </>
                    )}
                  </div>
                  {item.mode === "live" && (
                    <LiveSettings
                      idPrefix={`slot-item-${index}`}
                      value={liveConfigFrom(item.payload)}
                      onChange={(payload) => {
                        const items = [...draft.items];
                        items[index] = { ...item, payload };
                        setDraft({ ...draft, items });
                      }}
                    />
                  )}
                </div>
              ))}
              <Button
                variant="outline"
                onClick={() =>
                  setDraft({
                    ...draft,
                    items: [
                      ...draft.items,
                      { mode: "sponsors", payload: null, seconds: DEFAULT_ROTATION_SECONDS },
                    ],
                  })
                }
              >
                <PlusIcon aria-hidden="true" />
                {t("addToRotation")}
              </Button>
            </fieldset>
          </div>
        )}
      </Modal>
    </>
  );
}
