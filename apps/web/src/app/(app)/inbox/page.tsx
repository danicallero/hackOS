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

import { EVENTS } from "@hackos/shared/events";
import {
  CalendarClockIcon,
  CheckIcon,
  ChevronDownIcon,
  InboxIcon,
  PlusIcon,
  SlidersHorizontalIcon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
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
  };
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

  function toggleExpanded(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function markRead(item: InboxItem) {
    try {
      await notificationsApi.markInboxRead(item.id);
      notifyNotificationsRead();
      refetch();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotMarkRead"));
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
                  onClick={() => toggleExpanded(item.id)}
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
                    {unread && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => markRead(item)}
                        aria-label={t("markRead")}
                      >
                        <CheckIcon className="size-4" />
                        {t("markRead")}
                      </Button>
                    )}
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
  const [busy, setBusy] = useState(false);

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

  async function removeReminder(category: string, channels: NotificationChannel[]) {
    setBusy(true);
    try {
      const items: PreferenceOverride[] = channels.map((channel) => ({
        category,
        channel,
        enabled: false,
      }));
      const next = await notificationsApi.setPreferences(items);
      setPrefs(next);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotRemoveReminder"));
    } finally {
      setBusy(false);
    }
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

  const dynamicCategories = [
    ...new Set(
      prefs.overrides.map((o) => o.category).filter((category) => category.startsWith("schedule:")),
    ),
  ];

  const addableActivities = scheduleItems.filter(
    (item) =>
      !dynamicCategories.includes(`schedule:${item.id}`) &&
      new Date(item.endsAt).getTime() > Date.now(),
  );

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
    ...dynamicCategories.map((category) => ({
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
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.category} className="border-border border-b last:border-b-0">
                <td className="px-4 py-3">
                  {row.label}
                  {row.mandatory && (
                    <span className="text-muted-foreground ml-2 text-xs">({t("alwaysOn")})</span>
                  )}
                </td>
                {prefs.channels.map((channel) => {
                  const enabled = row.mandatory
                    ? true
                    : (overrideFor(row.category, channel)?.enabled ?? true);
                  return (
                    <td key={channel} className="px-4 py-3 text-center">
                      <Checkbox
                        checked={enabled}
                        disabled={row.mandatory || busy}
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
                <td className="px-2 text-right">
                  {row.category.startsWith("schedule:") && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => removeReminder(row.category, prefs.channels)}
                    >
                      {t("turnOff")}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </SectionCard>

      <SectionCard icon={CalendarClockIcon} title={t("activityReminders")}>
        {addableActivities.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("noUpcomingActivities")}</p>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
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
              disabled={!addingActivity || busy}
              onClick={() => addingActivity && addReminder(addingActivity)}
            >
              <PlusIcon className="size-4" />
              {t("addReminder")}
            </Button>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
