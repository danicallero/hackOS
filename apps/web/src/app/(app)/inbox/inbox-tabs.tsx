"use client";

// H50/H51 participant surface: in-app inbox with read state, and the
// notification preference matrix (incl. schedule-reminder opt-ins). Auth
// only — no capability gate, everyone has an inbox.
//
// Realtime: in-app notifications broadcast on the per-user SSE topic
// `user:<id>` (EVENTS.USER_NOTIFICATION). The only stream subscribed to that
// exact topic today is /api/queue/me/stream (queue/reads.routes.ts) — it's a
// generic "your own topic" stream despite living in the queue module, so we
// reuse it here instead of adding a new route.

import {
  ACTIVITY_KINDS,
  activityKindPluralKey,
  toActivityKind,
} from "@hackos/shared/activity-kinds";
import { EVENTS } from "@hackos/shared/events";
import { CalendarDotsIcon } from "@phosphor-icons/react/dist/csr/CalendarDots";
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import { CaretUpIcon } from "@phosphor-icons/react/dist/csr/CaretUp";
import { LockIcon } from "@phosphor-icons/react/dist/csr/Lock";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { SlidersHorizontalIcon } from "@phosphor-icons/react/dist/csr/SlidersHorizontal";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import { TrayIcon } from "@phosphor-icons/react/dist/csr/Tray";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertModal } from "@/components/common/alert-modal";
import { ContextualError } from "@/components/common/contextual-error";
import { EmptyState } from "@/components/common/empty-state";
import { EntityCombobox } from "@/components/common/entity-combobox";
import { Modal } from "@/components/common/modal";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useLiveQuery } from "@/hooks/use-event-source";
import { notifyNotificationsRead } from "@/hooks/use-unread-count";
import { ApiError } from "@/lib/api";
import { formatScheduledDateTime } from "@/lib/datetime";
import { type Translate, useLocale } from "@/lib/i18n";
import { logisticsApi, type PublicScheduleItem } from "@/lib/logistics";
import {
  type InboxItem,
  type NotificationChannel,
  notificationsApi,
  type PreferenceOverride,
  type PreferencesResponse,
  STATIC_CATEGORIES,
} from "@/lib/notifications";
import { toast } from "@/lib/toast";

const LIMIT = 20;
const PERSONAL_STREAM = "/api/queue/me/stream";

function categoryLabelMap(t: Translate): Record<string, string> {
  return {
    queue: t("categoryQueueCalls"),
    announcements: t("announcements"),
    application: t("categoryApplicationUpdates"),
    schedule: t("categoryReminderChannels"),
  };
}

/**
 * `schedule.type` labels (H51 kind-based reminders) — plural, from the shared
 * kind registry. Kinds are free text on the backend for rows created before a
 * category was retired, so an unrecognized one falls back to the raw string.
 */
function kindLabel(kind: string, t: Translate): string {
  const known = toActivityKind(kind);
  return known ? t(activityKindPluralKey(known)) : kind;
}

function channelLabelMap(t: Translate): Record<NotificationChannel, string> {
  return {
    in_app: t("channelInApp"),
    email: t("email"),
    push: t("channelPush"),
  };
}

/** Channels a fresh schedule-reminder opt-in writes explicitly, matching service.ts DEFAULT_CHANNELS. */
const REMINDER_DEFAULT_CHANNELS: NotificationChannel[] = ["in_app", "email", "push"];

function payloadField(payload: unknown, key: "subject" | "body"): string | null {
  if (!payload || typeof payload !== "object") return null;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value : null;
}

/** Internal to the notify() pipeline (see notifications/templates.ts) — not useful to show a reader. */
const HIDDEN_PAYLOAD_KEYS = new Set([
  "subject",
  "body",
  "template",
  "vars",
  "recipient",
  "language",
]);

function humanizeKey(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Every other field the sender attached (e.g. roomName, challengeTitle) — the "all data" behind the rendered subject/body. */
function payloadDetails(payload: unknown): Array<{ key: string; value: string }> {
  if (!payload || typeof payload !== "object") return [];
  return Object.entries(payload as Record<string, unknown>)
    .filter(
      ([key, value]) => !HIDDEN_PAYLOAD_KEYS.has(key) && value !== null && value !== undefined,
    )
    .map(([key, value]) => ({
      key: humanizeKey(key),
      value: typeof value === "string" ? value : JSON.stringify(value),
    }));
}

function categoryLabel(
  category: string,
  scheduleItems: PublicScheduleItem[],
  t: Translate,
): string {
  const labels = categoryLabelMap(t);
  if (labels[category]) return labels[category];
  if (category.startsWith("schedule:type:")) {
    const kind = category.slice("schedule:type:".length);
    return t("reminderKindLabel", { kind: kindLabel(kind, t) });
  }
  if (category.startsWith("schedule:")) {
    const id = Number(category.slice("schedule:".length));
    const item = scheduleItems.find((i) => i.id === id);
    return item ? t("activityLabel", { title: item.title }) : t("activityUnavailable", { id });
  }
  return category;
}

export function MessagesTab() {
  const { t } = useLocale();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [offset, setOffset] = useState(0);
  // Which items are expanded to show the full body + every other payload field.
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [deleting, setDeleting] = useState<InboxItem | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const fetcher = useCallback(
    () => notificationsApi.listInbox({ unread: unreadOnly || undefined, limit: LIMIT, offset }),
    [unreadOnly, offset],
  );

  const { data, loading, error, refetch } = useLiveQuery(
    fetcher,
    PERSONAL_STREAM,
    [EVENTS.USER_NOTIFICATION],
    { queryKey: [unreadOnly, offset] },
  );

  async function markRead(item: InboxItem) {
    try {
      await notificationsApi.markInboxRead(item.id);
      notifyNotificationsRead();
      refetch();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : t("couldNotMarkRead"),
        t("toastMarkRead"),
      );
    }
  }

  // Desktop parity with mobile (apps/mobile notifications tab): opening an
  // item marks it seen automatically, no separate "mark read" click needed.
  function toggleExpanded(item: InboxItem) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      return next;
    });
    if (!item.read_at) void markRead(item);
  }

  async function remove(item: InboxItem) {
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await notificationsApi.deleteInbox(item.id);
      notifyNotificationsRead();
      setDeleting(null);
      refetch();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t("couldNotDeleteNotification");
      setDeleteError(message);
      toast.error(message, t("toastDeleteMessage"));
    } finally {
      setDeleteBusy(false);
    }
  }

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const rangeEnd = Math.min(offset + LIMIT, total);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Switch
          id="unread-only"
          checked={unreadOnly}
          onCheckedChange={(checked) => {
            setUnreadOnly(checked);
            setOffset(0);
          }}
        />
        <Label htmlFor="unread-only" className="font-normal">
          {t("unreadOnly")}
        </Label>
      </div>

      {loading && !data ? (
        <div className="flex justify-center py-12">
          <Spinner className="size-5" />
        </div>
      ) : error ? (
        <EmptyState
          icon={TrayIcon}
          title={t("couldNotLoadInboxTitle")}
          description={t("couldNotLoadInboxDesc")}
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={TrayIcon}
          title={unreadOnly ? t("noUnreadMessages") : t("noMessagesYet")}
        />
      ) : (
        <ul className="space-y-3">
          {items.map((item) => {
            const unread = !item.read_at;
            const subject = payloadField(item.payload, "subject") ?? item.category;
            const body = payloadField(item.payload, "body");
            const details = payloadDetails(item.payload);
            const isOpen = expanded.has(item.id);
            return (
              <li
                key={item.id}
                className={`overflow-hidden rounded-surface border ${unread ? "border-primary/40 bg-card" : "bg-card"}`}
              >
                <button
                  type="button"
                  onClick={() => toggleExpanded(item)}
                  aria-expanded={isOpen}
                  aria-controls={`message-${item.id}`}
                  className="button-interaction flex w-full items-start gap-3 px-4 py-4 text-left transition-colors hover:bg-muted/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:px-5"
                >
                  <span
                    className={`mt-1.5 size-2 shrink-0 rounded-full ${unread ? "bg-primary" : "bg-transparent"}`}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                      <h2
                        className={`min-w-0 wrap-break-word text-sm ${unread ? "font-semibold" : "font-medium"}`}
                      >
                        {subject}
                      </h2>
                      <time
                        dateTime={item.created_at}
                        className="shrink-0 text-muted-foreground text-xs tabular-nums"
                      >
                        {formatScheduledDateTime(item.created_at)}
                      </time>
                    </div>
                    {body && !isOpen && (
                      <p className="line-clamp-2 text-muted-foreground text-sm">{body}</p>
                    )}
                  </div>
                  {isOpen ? (
                    <CaretUpIcon
                      className="mt-1 size-4 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                  ) : (
                    <CaretDownIcon
                      className="mt-1 size-4 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                  )}
                </button>

                {isOpen && (
                  <div
                    id={`message-${item.id}`}
                    className="mx-4 space-y-5 border-t border-border/60 pb-4 pt-4 ps-5 sm:mx-5"
                  >
                    {body && (
                      <p className="whitespace-pre-line wrap-break-word text-sm leading-relaxed">
                        {body}
                      </p>
                    )}
                    {details.length > 0 && (
                      <dl className="grid max-w-xl gap-x-6 gap-y-2 border-t border-border/40 pt-4 text-xs sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                        {details.map((d) => (
                          <div key={d.key} className="contents">
                            <dt className="text-muted-foreground">{d.key}</dt>
                            <dd className="min-w-0 wrap-break-word">{d.value}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="-ms-3 text-muted-foreground hover:text-destructive"
                      onClick={() => {
                        setDeleteError(null);
                        setDeleting(item);
                      }}
                    >
                      <TrashIcon className="size-4" aria-hidden="true" />
                      {t("deleteAction")}
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {total > LIMIT && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground text-xs">
            {t("rangeOfTotal", { start: offset + 1, end: rangeEnd, total })}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={offset === 0}
              onClick={() => setOffset((o) => Math.max(0, o - LIMIT))}
            >
              {t("previous")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={rangeEnd >= total}
              onClick={() => setOffset((o) => o + LIMIT)}
            >
              {t("next")}
            </Button>
          </div>
        </div>
      )}

      {deleting && (
        <AlertModal
          open={Boolean(deleting)}
          onOpenChange={(open) => {
            if (!open) {
              setDeleteError(null);
              setDeleting(null);
            }
          }}
          title={t("deleteThisNotification")}
          description={t("deleteNotificationDesc")}
          cancelLabel={t("cancel")}
          confirmLabel={t("deleteAction")}
          destructive
          pending={deleteBusy}
          onConfirm={() => remove(deleting)}
        >
          {deleteError && <ContextualError message={deleteError} />}
        </AlertModal>
      )}
    </div>
  );
}

export function PreferencesTab() {
  const { t } = useLocale();
  const channelLabels = channelLabelMap(t);
  const [prefs, setPrefs] = useState<PreferencesResponse | null>(null);
  const [scheduleItems, setScheduleItems] = useState<PublicScheduleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [reminderPickerOpen, setReminderPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [removalStates, setRemovalStates] = useState<
    Record<string, "queued" | "removing" | "failed">
  >({});
  const removalQueue = useRef<Array<{ category: string; channels: NotificationChannel[] }>>([]);
  const queuedRemovalCategories = useRef(new Set<string>());
  const processingRemovals = useRef(false);

  // Track "now" as ticking state to avoid Date.now() calls during render.
  // Updated every 30s since this only filters for "still upcoming" items, not per-second precision.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  const load = useCallback(async () => {
    try {
      const [prefsRes, scheduleRes] = await Promise.all([
        notificationsApi.getPreferences(),
        logisticsApi.publicSchedule(),
      ]);
      setPrefs(prefsRes);
      setScheduleItems(scheduleRes.items);
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : t("couldNotLoadPreferencesToast"),
        t("toastNotificationSettings"),
      );
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    // Fetching notification preferences from the API is a legitimate external-system sync on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(); // NOSONAR: data-fetch-on-mount pattern; external API sync is intentional
  }, [load]);

  async function toggle(category: string, channel: NotificationChannel, enabled: boolean) {
    setBusy(true);
    try {
      const next = await notificationsApi.setPreferences([{ category, channel, enabled }]);
      setPrefs(next);
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : t("couldNotSavePreference"),
        t("toastNotificationSettings"),
      );
    } finally {
      setBusy(false);
    }
  }

  async function addReminder(activityId: string) {
    setBusy(true);
    try {
      const items: PreferenceOverride[] = REMINDER_DEFAULT_CHANNELS.map((channel) => ({
        category: `schedule:${activityId}`,
        channel,
        enabled: true,
      }));
      const next = await notificationsApi.setPreferences(items);
      setPrefs(next);
      setReminderPickerOpen(false);
      toast.success(t("reminderAdded"), { compactTitle: t("addReminder") });
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : t("couldNotAddReminder"),
        t("addReminder"),
      );
    } finally {
      setBusy(false);
    }
  }

  async function addKindReminder(kind: string) {
    setBusy(true);
    try {
      const items: PreferenceOverride[] = REMINDER_DEFAULT_CHANNELS.map((channel) => ({
        category: `schedule:type:${kind}`,
        channel,
        enabled: true,
      }));
      const next = await notificationsApi.setPreferences(items);
      setPrefs(next);
      setReminderPickerOpen(false);
      toast.success(t("reminderAdded"), { compactTitle: t("addReminder") });
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : t("couldNotAddReminder"),
        t("addReminder"),
      );
    } finally {
      setBusy(false);
    }
  }

  async function drainRemovalQueue() {
    if (processingRemovals.current) return;
    processingRemovals.current = true;
    while (removalQueue.current.length > 0) {
      const operation = removalQueue.current.shift();
      if (!operation) continue;
      setRemovalStates((current) => ({ ...current, [operation.category]: "removing" }));
      try {
        const items: PreferenceOverride[] = operation.channels.map((channel) => ({
          category: operation.category,
          channel,
          enabled: false,
        }));
        const next = await notificationsApi.setPreferences(items);
        setPrefs(next);
        setRemovalStates((current) => {
          const nextStates = { ...current };
          delete nextStates[operation.category];
          return nextStates;
        });
      } catch (err) {
        setRemovalStates((current) => ({ ...current, [operation.category]: "failed" }));
        toast.error(
          err instanceof ApiError ? err.message : t("couldNotRemoveReminder"),
          t("toastRemoveReminder"),
        );
      } finally {
        queuedRemovalCategories.current.delete(operation.category);
      }
    }
    processingRemovals.current = false;
  }

  function enqueueReminderRemoval(category: string, channels: NotificationChannel[]) {
    if (queuedRemovalCategories.current.has(category)) return;
    queuedRemovalCategories.current.add(category);
    setRemovalStates((current) => ({ ...current, [category]: "queued" }));
    removalQueue.current.push({ category, channels });
    void drainRemovalQueue();
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner className="size-5" />
      </div>
    );
  }

  if (!prefs) {
    return (
      <EmptyState
        icon={SlidersHorizontalIcon}
        title={t("couldNotLoadPreferencesTitle")}
        description={t("couldNotLoadPreferencesDesc")}
      />
    );
  }

  const enabledReminderCategories = [
    ...new Set(
      prefs.overrides
        .filter((o) => o.enabled && o.category.startsWith("schedule:"))
        .map((o) => o.category),
    ),
  ];
  const individualReminders = enabledReminderCategories.filter(
    (category) => !category.startsWith("schedule:type:"),
  );
  const kindReminders = enabledReminderCategories.filter((category) =>
    category.startsWith("schedule:type:"),
  );

  const upcomingItems = scheduleItems.filter((item) => new Date(item.endsAt).getTime() > now);
  const addableActivities = upcomingItems.filter(
    (item) => !individualReminders.includes(`schedule:${item.id}`),
  );
  const addableKinds = [
    ...new Set([
      ...ACTIVITY_KINDS,
      ...scheduleItems.map((item) => item.type).filter((kind): kind is string => !!kind),
    ]),
  ].filter((kind) => !kindReminders.includes(`schedule:type:${kind}`));
  const pendingRemovalCount = Object.values(removalStates).filter(
    (state) => state === "queued" || state === "removing",
  ).length;

  function overrideFor(category: string, channel: NotificationChannel) {
    return prefs?.overrides.find((o) => o.category === category && o.channel === channel);
  }

  const rows: { category: string; label: string; mandatory?: boolean }[] = [
    ...prefs.mandatoryCategories.map((category) => ({
      category,
      label: categoryLabel(category, scheduleItems, t),
      mandatory: true,
    })),
    ...STATIC_CATEGORIES.map((category) => ({
      category,
      label: categoryLabel(category, scheduleItems, t),
    })),
  ];

  return (
    <div className="space-y-12">
      <SectionCard variant="plain" title={t("notificationChannels")}>
        <div className="divide-y divide-border/60">
          {rows.map((row) => {
            const enabledChannels = prefs.channels.filter(
              (channel) => row.mandatory || (overrideFor(row.category, channel)?.enabled ?? true),
            );
            return (
              <div
                key={row.category}
                className="flex flex-wrap items-center justify-between gap-3 py-4"
              >
                <div className="min-w-0 flex flex-wrap items-baseline gap-x-2">
                  <p className="text-sm font-medium">{row.label}</p>
                  {row.mandatory && (
                    <span className="text-xs text-muted-foreground">{t("alwaysOn")}</span>
                  )}
                </div>
                {row.mandatory ? (
                  <span className="inline-flex min-h-(--control-height-default) max-w-full items-center gap-2 px-4 text-sm text-muted-foreground">
                    <span className="min-w-0 text-end">
                      {enabledChannels.map((channel) => channelLabels[channel]).join(", ")}
                    </span>
                    <LockIcon className="size-4 shrink-0" aria-hidden="true" />
                  </span>
                ) : (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        disabled={busy || pendingRemovalCount > 0}
                        className="max-w-full justify-between text-muted-foreground"
                        aria-label={t("notificationChannelsFor", { label: row.label })}
                      >
                        <span className="min-w-0 whitespace-normal text-end">
                          {enabledChannels.length > 0
                            ? enabledChannels.map((channel) => channelLabels[channel]).join(", ")
                            : t("notificationsOff")}
                        </span>
                        <CaretDownIcon className="size-4 shrink-0" aria-hidden="true" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {prefs.channels.map((channel) => (
                        <DropdownMenuCheckboxItem
                          key={channel}
                          checked={overrideFor(row.category, channel)?.enabled ?? true}
                          disabled={busy || pendingRemovalCount > 0}
                          onSelect={(event) => event.preventDefault()}
                          onCheckedChange={(enabled) => toggle(row.category, channel, enabled)}
                        >
                          {channelLabels[channel]}
                        </DropdownMenuCheckboxItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            );
          })}
        </div>
      </SectionCard>

      <SectionCard
        variant="plain"
        icon={CalendarDotsIcon}
        title={t("activeReminders")}
        action={
          <Modal
            trigger={
              <Button variant="outline" disabled={busy || pendingRemovalCount > 0}>
                <PlusIcon className="size-4" aria-hidden="true" />
                {t("addReminder")}
              </Button>
            }
            open={reminderPickerOpen}
            onOpenChange={(open) => {
              if (!busy) setReminderPickerOpen(open);
            }}
            title={t("addReminder")}
            icon={CalendarDotsIcon}
          >
            <div className="space-y-6">
              <div className="space-y-2">
                <Label id="reminder-activity-label">{t("activityLabelShort")}</Label>
                {addableActivities.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("noUpcomingActivities")}</p>
                ) : (
                  <EntityCombobox
                    options={addableActivities}
                    value=""
                    getId={(item) => item.id}
                    getLabel={(item) => `${item.title} — ${formatScheduledDateTime(item.startsAt)}`}
                    onChange={(id) => void addReminder(id)}
                    disabled={busy || pendingRemovalCount > 0}
                    inDialog
                    aria-labelledby="reminder-activity-label"
                    placeholder={t("chooseActivity")}
                  />
                )}
              </div>
              <div className="space-y-2">
                <Label id="reminder-kind-label">{t("activityKindLabel")}</Label>
                {addableKinds.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("noUpcomingActivityKinds")}</p>
                ) : (
                  <EntityCombobox
                    options={addableKinds}
                    value=""
                    getId={(kind) => kind}
                    getLabel={(kind) => kindLabel(kind, t)}
                    onChange={(kind) => void addKindReminder(kind)}
                    disabled={busy || pendingRemovalCount > 0}
                    inDialog
                    aria-labelledby="reminder-kind-label"
                    placeholder={t("chooseActivityKind")}
                  />
                )}
              </div>
              {busy && (
                <div
                  role="status"
                  className="flex items-center gap-2 text-sm text-muted-foreground"
                >
                  <Spinner className="size-4" />
                  {t("loading")}
                </div>
              )}
            </div>
          </Modal>
        }
      >
        <div className="space-y-4">
          {pendingRemovalCount > 0 && (
            <div
              className="bg-muted flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
              role="status"
              aria-live="polite"
            >
              <Spinner className="size-4" />
              <span className="tabular-nums">
                {t("reminderRemovalProgress", { count: pendingRemovalCount })}
              </span>
            </div>
          )}
          {enabledReminderCategories.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("noActiveReminders")}</p>
          ) : (
            <ul className="divide-border divide-y">
              {enabledReminderCategories.map((category) => {
                const label = categoryLabel(category, scheduleItems, t);
                const removalState = removalStates[category];
                return (
                  <li
                    key={category}
                    className="flex flex-wrap items-center justify-between gap-3 py-4 text-sm"
                  >
                    <div className="min-w-0 flex-1">
                      <span className="block wrap-break-word text-pretty">{label}</span>
                      {removalState === "failed" && (
                        <span className="text-destructive block text-xs" role="alert">
                          {t("couldNotRemoveReminder")}
                        </span>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {(removalState === "queued" || removalState === "removing") && (
                        <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
                          <Spinner className="size-3.5" />
                          {t(removalState === "queued" ? "removalQueued" : "removingReminder")}
                        </span>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy || removalState === "queued" || removalState === "removing"}
                        onClick={() => enqueueReminderRemoval(category, prefs.channels)}
                        aria-label={t("removeReminderAria", { label })}
                        loading={busy}
                      >
                        {removalState === "failed" ? t("retry") : t("turnOff")}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </SectionCard>
    </div>
  );
}
