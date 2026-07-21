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

import { ACTIVITY_KINDS } from "@hackos/shared/activity-kinds";
import { EVENTS } from "@hackos/shared/events";
import {
  CalendarClockIcon,
  ChevronDownIcon,
  InboxIcon,
  LockIcon,
  PlusIcon,
  SlidersHorizontalIcon,
  Trash2Icon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ContextualError } from "@/components/common/contextual-error";
import { EmptyState } from "@/components/common/empty-state";
import { Modal } from "@/components/common/modal";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
import { SubmitButton } from "@/components/common/submit-button";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

/** `schedule.type` labels (H51 kind-based reminders) — free text on the backend, not DB-enforced, so unrecognized kinds fall back to the raw string. */
function kindLabelMap(t: Translate): Record<string, string> {
  return {
    meal: t("kindMeal"),
    workshop: t("kindWorkshop"),
    talk: t("kindTalk"),
    ceremony: t("kindCeremony"),
    activity: t("kindActivity"),
    other: t("kindOther"),
  };
}

function kindLabel(kind: string, t: Translate): string {
  return kindLabelMap(t)[kind] ?? kind;
}

function channelLabelMap(t: Translate): Record<NotificationChannel, string> {
  return {
    in_app: t("channelInApp"),
    email: t("email"),
    push: t("channelPush"),
    discord: t("channelDiscord"),
  };
}

/** Channels a fresh schedule-reminder opt-in writes explicitly (discord stays post-MVP, same as service.ts DEFAULT_CHANNELS). */
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

export default function InboxPage() {
  const { t } = useLocale();
  return (
    <div className="space-y-6">
      <PageHeader title={t("inbox")} />
      <Tabs defaultValue="messages">
        <TabsList>
          <TabsTrigger value="messages">{t("messages")}</TabsTrigger>
          <TabsTrigger value="preferences">{t("preferences")}</TabsTrigger>
        </TabsList>
        <TabsContent value="messages" className="pt-4">
          <MessagesTab />
        </TabsContent>
        <TabsContent value="preferences" className="pt-4">
          <PreferencesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function MessagesTab() {
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
      toast.error(err instanceof ApiError ? err.message : t("couldNotMarkRead"));
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
      toast.error(message);
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
          icon={InboxIcon}
          title={t("couldNotLoadInboxTitle")}
          description={t("couldNotLoadInboxDesc")}
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={InboxIcon}
          title={unreadOnly ? t("noUnreadMessages") : t("noMessagesYet")}
          description={t("messagesWillShowUp")}
        />
      ) : (
        <ul className="divide-border divide-y rounded-lg border">
          {items.map((item) => {
            const unread = !item.read_at;
            const subject = payloadField(item.payload, "subject") ?? item.category;
            const body = payloadField(item.payload, "body");
            const details = payloadDetails(item.payload);
            const isOpen = expanded.has(item.id);
            return (
              <li key={item.id} className={unread ? "bg-primary/5" : ""}>
                <button
                  type="button"
                  onClick={() => toggleExpanded(item)}
                  aria-expanded={isOpen}
                  className="hover:bg-muted/50 flex w-full items-start gap-3 p-4 text-left"
                >
                  <span
                    className={`mt-1.5 size-2 shrink-0 rounded-full ${unread ? "bg-primary" : "bg-transparent"}`}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className={`text-sm ${unread ? "font-semibold" : "font-medium"}`}>
                        {subject}
                      </p>
                      <span className="text-muted-foreground text-xs">
                        {formatScheduledDateTime(item.created_at)}
                      </span>
                    </div>
                    {body && (
                      <p
                        className={`text-muted-foreground text-sm ${isOpen ? "whitespace-pre-line" : "line-clamp-2"}`}
                      >
                        {body}
                      </p>
                    )}
                  </div>
                  <ChevronDownIcon
                    className={`text-muted-foreground mt-1 size-4 shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`}
                    aria-hidden
                  />
                </button>

                {isOpen && (
                  <div className="border-border space-y-3 border-t px-4 py-3 pl-10">
                    {details.length > 0 ? (
                      <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-sm">
                        {details.map((d) => (
                          <div key={d.key} className="contents">
                            <dt className="text-muted-foreground">{d.key}</dt>
                            <dd className="min-w-0 break-words">{d.value}</dd>
                          </div>
                        ))}
                      </dl>
                    ) : (
                      <p className="text-muted-foreground text-sm">{t("noAdditionalDetails")}</p>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => {
                        setDeleteError(null);
                        setDeleting(item);
                      }}
                      aria-label={t("deleteNotificationAria")}
                    >
                      <Trash2Icon className="size-4" />
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
        <Modal
          open={Boolean(deleting)}
          onOpenChange={(open) => {
            if (!open) {
              setDeleteError(null);
              setDeleting(null);
            }
          }}
          title={t("deleteThisNotification")}
          description={t("deleteNotificationDesc")}
          footer={
            <>
              <Button variant="outline" onClick={() => setDeleting(null)}>
                {t("cancel")}
              </Button>
              <SubmitButton
                variant="destructive"
                pending={deleteBusy}
                onClick={() => remove(deleting)}
              >
                {t("deleteAction")}
              </SubmitButton>
            </>
          }
        >
          {deleteError && <ContextualError message={deleteError} />}
        </Modal>
      )}
    </div>
  );
}

function PreferencesTab() {
  const { t } = useLocale();
  const channelLabels = channelLabelMap(t);
  const [prefs, setPrefs] = useState<PreferencesResponse | null>(null);
  const [scheduleItems, setScheduleItems] = useState<PublicScheduleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [addingActivity, setAddingActivity] = useState("");
  const [addingKind, setAddingKind] = useState("");
  const [busy, setBusy] = useState(false);
  const [removalStates, setRemovalStates] = useState<
    Record<string, "queued" | "removing" | "failed">
  >({});
  const removalQueue = useRef<Array<{ category: string; channels: NotificationChannel[] }>>([]);
  const queuedRemovalCategories = useRef(new Set<string>());
  const processingRemovals = useRef(false);

  const load = useCallback(async () => {
    try {
      const [prefsRes, scheduleRes] = await Promise.all([
        notificationsApi.getPreferences(),
        logisticsApi.publicSchedule(),
      ]);
      setPrefs(prefsRes);
      setScheduleItems(scheduleRes.items);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotLoadPreferencesToast"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(category: string, channel: NotificationChannel, enabled: boolean) {
    setBusy(true);
    try {
      const next = await notificationsApi.setPreferences([{ category, channel, enabled }]);
      setPrefs(next);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotSavePreference"));
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
      setAddingActivity("");
      toast.success(t("reminderAdded"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotAddReminder"));
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
      setAddingKind("");
      toast.success(t("reminderAdded"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotAddReminder"));
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
        toast.error(err instanceof ApiError ? err.message : t("couldNotRemoveReminder"));
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

  const upcomingItems = scheduleItems.filter(
    (item) => new Date(item.endsAt).getTime() > Date.now(),
  );
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
    <div className="space-y-6">
      <SectionCard
        icon={SlidersHorizontalIcon}
        title={t("notificationChannels")}
        bodyClassName="overflow-x-auto p-0"
      >
        <table className="w-full text-sm">
          <thead>
            <tr className="border-border border-b">
              <th className="px-4 py-3 text-left font-medium">{t("category")}</th>
              {prefs.channels.map((channel) => (
                <th key={channel} className="px-4 py-3 text-center font-medium">
                  {channelLabels[channel]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.category} className="border-border border-b last:border-b-0">
                <td className="px-4 py-3">
                  {row.label}
                  {row.mandatory && (
                    <span className="text-muted-foreground ml-2 inline-flex items-center gap-1 text-xs">
                      <LockIcon className="size-3" aria-hidden="true" />
                      {t("alwaysOn")}
                    </span>
                  )}
                </td>
                {prefs.channels.map((channel) => {
                  if (row.mandatory) {
                    return (
                      <td key={channel} className="px-4 py-3 text-center">
                        <span
                          className="text-muted-foreground inline-flex items-center justify-center"
                          title={t("mandatoryChannelTitle")}
                          role="img"
                          aria-label={t("mandatoryChannelAria", {
                            channel: channelLabels[channel],
                            label: row.label,
                          })}
                        >
                          <LockIcon className="size-4" aria-hidden="true" />
                        </span>
                      </td>
                    );
                  }
                  const enabled = overrideFor(row.category, channel)?.enabled ?? true;
                  return (
                    <td key={channel} className="px-4 py-3 text-center">
                      <Checkbox
                        checked={enabled}
                        disabled={busy || pendingRemovalCount > 0}
                        onCheckedChange={(checked) =>
                          toggle(row.category, channel, checked === true)
                        }
                        aria-label={t("channelForRow", {
                          channel: channelLabels[channel],
                          label: row.label,
                        })}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </SectionCard>

      <SectionCard icon={CalendarClockIcon} title={t("activityReminders")}>
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
          <div>
            <p className="mb-2 text-sm font-medium">{t("activeReminders")}</p>
            {enabledReminderCategories.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t("noActiveReminders")}</p>
            ) : (
              <ul className="divide-border divide-y rounded-lg border">
                {enabledReminderCategories.map((category) => {
                  const label = categoryLabel(category, scheduleItems, t);
                  const removalState = removalStates[category];
                  return (
                    <li
                      key={category}
                      className="flex items-center justify-between gap-3 px-4 py-2 text-sm"
                    >
                      <div className="min-w-0 flex-1">
                        <span className="block truncate">{label}</span>
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
                          disabled={
                            busy || removalState === "queued" || removalState === "removing"
                          }
                          onClick={() => enqueueReminderRemoval(category, prefs.channels)}
                          aria-label={t("removeReminderAria", { label })}
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

          <div className="flex flex-wrap items-end gap-2">
            {addableActivities.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t("noUpcomingActivities")}</p>
            ) : (
              <>
                <Select value={addingActivity} onValueChange={setAddingActivity}>
                  <SelectTrigger className="w-64">
                    <SelectValue placeholder={t("chooseActivity")} />
                  </SelectTrigger>
                  <SelectContent>
                    {addableActivities.map((item) => (
                      <SelectItem key={item.id} value={String(item.id)}>
                        {item.title} — {formatScheduledDateTime(item.startsAt)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  disabled={!addingActivity || busy || pendingRemovalCount > 0}
                  onClick={() => addingActivity && addReminder(addingActivity)}
                >
                  <PlusIcon className="size-4" />
                  {t("addReminder")}
                </Button>
              </>
            )}
          </div>

          <div className="flex flex-wrap items-end gap-2">
            {addableKinds.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t("noUpcomingActivityKinds")}</p>
            ) : (
              <>
                <Select value={addingKind} onValueChange={setAddingKind}>
                  <SelectTrigger className="w-64">
                    <SelectValue placeholder={t("chooseActivityKind")} />
                  </SelectTrigger>
                  <SelectContent>
                    {addableKinds.map((kind) => (
                      <SelectItem key={kind} value={kind}>
                        {kindLabel(kind, t)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  disabled={!addingKind || busy || pendingRemovalCount > 0}
                  onClick={() => addingKind && addKindReminder(addingKind)}
                >
                  <PlusIcon className="size-4" />
                  {t("addReminder")}
                </Button>
              </>
            )}
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
