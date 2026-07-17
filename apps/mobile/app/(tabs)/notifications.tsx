import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS } from "@hackos/shared/events";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, Switch, Text, useColorScheme, View } from "react-native";

import { ActionButton, EmptyState, Section, Separator } from "@/components/native-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { SegmentedControl } from "@/components/segmented-control";
import { StaleDataBanner } from "@/components/stale-data-banner";
import { apiFetch } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { useMeContext } from "@/lib/me-context";
import {
  emitNotificationChange,
  subscribeToCategory,
  subscribeToNotificationChanges,
} from "@/lib/notification-events";
import { subscribeToServerEvent } from "@/lib/server-events";
import { useCachedApi } from "@/lib/use-cached-api";
import { colors } from "@/theme/colors";

type Channel = "in_app" | "email" | "push" | "discord";

interface Preferences {
  channels: Channel[];
  mandatoryCategories: string[];
  overrides: { category: string; channel: Channel; enabled: boolean }[];
}

interface InboxItem {
  id: number;
  category: string;
  payload: unknown;
  status: string;
  sent_at: string | null;
  read_at: string | null;
  created_at: string;
}

interface InboxResponse {
  items: InboxItem[];
  total: number;
}

const LIMIT = 20;

/** Full in-app inbox and notification preferences, matching the web participant view. */
export default function NotificationsScreen() {
  useColorScheme();
  const { t } = useLocale();
  const [selectedIndex, setSelectedIndex] = useState(0);

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ gap: 18, padding: 16, paddingBottom: 32 }}
      keyboardShouldPersistTaps="handled"
    >
      <SegmentedControl
        label={t("tabNotifications")}
        values={[t("notificationsMessages"), t("notificationsPreferences")]}
        selectedIndex={selectedIndex}
        onChange={setSelectedIndex}
      />
      {selectedIndex === 0 ? <MessagesView /> : <PreferencesView />}
    </ScrollView>
  );
}

function MessagesView() {
  const { t, language } = useLocale();
  const { me } = useMeContext();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [actionError, setActionError] = useState<Error | null>(null);

  const fetchInbox = useCallback(async () => {
    const query = unreadOnly ? "&unread=true" : "";
    return apiFetch<InboxResponse>(`/api/me/notifications?limit=${LIMIT}&offset=0${query}`);
  }, [unreadOnly]);
  const { data, loading, error, staleSince, load, setData } = useCachedApi(
    `user:${me?.id ?? "unknown"}:notifications:${unreadOnly ? "unread" : "all"}`,
    fetchInbox,
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => subscribeToCategory("announcements", () => void load()), [load]);
  useEffect(() => subscribeToServerEvent(EVENTS.USER_NOTIFICATION, () => void load()), [load]);

  async function markRead(item: InboxItem) {
    if (item.read_at) return;
    setActionError(null);
    try {
      const result = await apiFetch<{ id: number; read_at: string }>(
        `/api/me/notifications/${item.id}/read`,
        {
          method: "POST",
        },
      );
      setData((current) =>
        current
          ? {
              ...current,
              items: current.items.map((row) =>
                row.id === item.id ? { ...row, read_at: result.read_at } : row,
              ),
            }
          : current,
      );
      emitNotificationChange();
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause : new Error("Failed to mark notification read"),
      );
    }
  }

  function toggleExpanded(item: InboxItem) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      return next;
    });
    if (!item.read_at) void markRead(item);
  }

  const items = data?.items ?? [];

  return (
    <View style={{ gap: 16 }}>
      <StaleDataBanner updatedAt={staleSince} />
      <Section footer={t("notificationsUnreadHint")}>
        <View
          style={{
            alignItems: "center",
            flexDirection: "row",
            minHeight: 50,
            paddingHorizontal: 16,
          }}
        >
          <Text selectable style={{ color: colors.label, flex: 1, fontSize: 16 }}>
            {t("notificationsUnreadOnly")}
          </Text>
          <Switch
            accessibilityLabel={t("notificationsUnreadOnly")}
            style={{ alignSelf: "center" }}
            value={unreadOnly}
            onValueChange={setUnreadOnly}
          />
        </View>
      </Section>

      {error ? <RequestFeedback error={error} onRetry={() => void load()} /> : null}
      {actionError ? <RequestFeedback error={actionError} /> : null}
      {loading && !data ? <RequestFeedback loading /> : null}

      {!loading && !error && items.length === 0 ? (
        <EmptyState
          icon="tray"
          title={unreadOnly ? t("notificationsNoUnread") : t("notificationsEmptyTitle")}
          description={t("notificationsEmptyHint")}
        />
      ) : null}

      {items.length ? (
        <Section>
          {items.map((item, index) => (
            <View key={item.id}>
              {index > 0 ? <Separator inset={50} /> : null}
              <NotificationRow
                item={item}
                expanded={expanded.has(item.id)}
                language={language}
                onPress={() => toggleExpanded(item)}
              />
            </View>
          ))}
        </Section>
      ) : null}

      {data && data.total > LIMIT ? (
        <Text
          selectable
          style={{ color: colors.secondaryLabel, fontSize: 13, textAlign: "center" }}
        >
          {t("notificationsShowingLatest", { count: String(LIMIT), total: String(data.total) })}
        </Text>
      ) : null}

      <ActionButton
        label={t("refreshNotifications")}
        icon="arrow.clockwise"
        onPress={() => void load()}
      />
    </View>
  );
}

function NotificationRow({
  item,
  expanded,
  language,
  onPress,
}: {
  item: InboxItem;
  expanded: boolean;
  language: string;
  onPress: () => void;
}) {
  const subject = payloadField(item.payload, "subject") ?? item.category;
  const body = payloadField(item.payload, "body");
  const details = payloadDetails(item.payload);
  const unread = !item.read_at;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: pressed ? colors.elevatedSurface : colors.surface,
        gap: 9,
        paddingHorizontal: 16,
        paddingVertical: 14,
      })}
    >
      <View style={{ alignItems: "flex-start", flexDirection: "row", gap: 10 }}>
        <View
          accessibilityElementsHidden
          style={{
            backgroundColor: unread ? colors.accent : colors.transparent,
            borderRadius: 4,
            height: 8,
            marginTop: 6,
            width: 8,
          }}
        />
        <View style={{ flex: 1, gap: 5 }}>
          <View style={{ alignItems: "baseline", flexDirection: "row", gap: 8 }}>
            <Text
              selectable
              style={{
                color: colors.label,
                flex: 1,
                fontSize: 16,
                fontWeight: unread ? "700" : "500",
              }}
            >
              {subject}
            </Text>
            <Text
              selectable
              style={{ color: colors.tertiaryLabel, fontSize: 12, fontVariant: ["tabular-nums"] }}
            >
              {new Date(item.created_at).toLocaleDateString(language, {
                month: "short",
                day: "numeric",
              })}
            </Text>
          </View>
          {body ? (
            <Text
              selectable
              numberOfLines={expanded ? undefined : 2}
              style={{ color: colors.secondaryLabel, fontSize: 14, lineHeight: 20 }}
            >
              {body}
            </Text>
          ) : null}
          {expanded && details.length ? (
            <View
              style={{
                backgroundColor: colors.background,
                borderCurve: "continuous",
                borderRadius: 10,
                gap: 7,
                padding: 10,
              }}
            >
              {details.map((detail) => (
                <View key={detail.key} style={{ flexDirection: "row", gap: 8 }}>
                  <Text
                    selectable
                    style={{ color: colors.secondaryLabel, fontSize: 12, width: 90 }}
                  >
                    {detail.key}
                  </Text>
                  <Text selectable style={{ color: colors.label, flex: 1, fontSize: 12 }}>
                    {detail.value}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
        <SymbolView
          name={expanded ? "chevron.up" : "chevron.down"}
          tintColor={colors.tertiaryLabel}
          size={14}
          accessible={false}
        />
      </View>
    </Pressable>
  );
}

function PreferencesView() {
  const { t } = useLocale();
  const { me } = useMeContext();
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<Error | null>(null);

  const fetchPreferences = useCallback(
    () => apiFetch<Preferences>("/api/me/notification-preferences"),
    [],
  );
  const {
    data: prefs,
    loading,
    error,
    staleSince,
    load,
    setData,
  } = useCachedApi(`user:${me?.id ?? "unknown"}:notification-preferences`, fetchPreferences);

  useEffect(() => {
    void load();
  }, [load]);

  // Keeps this tab in sync with reminder toggles made elsewhere (e.g. the
  // schedule card/detail bell), which mount their own independent cache
  // instance for the same preferences (H51).
  useEffect(() => subscribeToNotificationChanges(() => void load()), [load]);

  function enabledFor(category: string, channel: Channel): boolean {
    const override = prefs?.overrides.find(
      (row) => row.category === category && row.channel === channel,
    );
    return override ? override.enabled : category !== "queue.staff";
  }

  async function toggle(category: string, channel: Channel, enabled: boolean) {
    const key = `${category}:${channel}`;
    setSavingKey(key);
    setActionError(null);
    try {
      const next = await savePreferences([{ category, channel, enabled }]);
      setData(next);
      emitNotificationChange();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause : new Error("Failed to save preference"));
    } finally {
      setSavingKey(null);
    }
  }

  if (!prefs)
    return <RequestFeedback loading={loading} error={error} onRetry={() => void load()} />;

  // Application decisions are email-only and intentionally have no mobile
  // preference: accepted/rejected applicants must always receive them.
  const editableCategories = ["announcements"];
  const capabilities = me?.capabilities ?? [];
  const canReceiveQueueStaffAlerts =
    capabilities.includes(CAPABILITIES.ADMIN_ALL) ||
    capabilities.includes(CAPABILITIES.QUEUE_OPERATE) ||
    capabilities.includes(CAPABILITIES.QUEUE_ADMIN) ||
    capabilities.includes(CAPABILITIES.JUDGE_PANEL);

  return (
    <View style={{ gap: 18 }}>
      <StaleDataBanner updatedAt={staleSince} />
      {actionError ? <RequestFeedback error={actionError} /> : null}
      <Section title={t("notificationsRequired")} footer={t("notificationsMandatoryHint")}>
        <View style={{ alignItems: "center", flexDirection: "row", gap: 12, padding: 16 }}>
          <SymbolView
            name="bell.badge.fill"
            tintColor={colors.accent}
            size={22}
            accessible={false}
          />
          <Text
            selectable
            style={{ color: colors.label, flex: 1, fontSize: 16, fontWeight: "600" }}
          >
            {t("queueCalls")}
          </Text>
          <View style={{ alignItems: "center", flexDirection: "row", gap: 4 }}>
            <SymbolView
              name="lock.fill"
              tintColor={colors.secondaryLabel}
              size={13}
              accessible={false}
            />
            <Text selectable style={{ color: colors.secondaryLabel, fontSize: 14 }}>
              {t("notificationsAlwaysOn")}
            </Text>
          </View>
        </View>
      </Section>

      {canReceiveQueueStaffAlerts ? (
        <Section title={t("notificationsQueueStaff")} footer={t("notificationsQueueStaffHint")}>
          <View
            style={{
              alignItems: "center",
              flexDirection: "row",
              minHeight: 50,
              paddingHorizontal: 16,
            }}
          >
            <Text selectable style={{ color: colors.label, flex: 1, fontSize: 16 }}>
              {t("notificationsPush")}
            </Text>
            <Switch
              accessibilityLabel={`${t("notificationsQueueStaff")}, ${t("notificationsPush")}`}
              disabled={savingKey !== null}
              style={{ alignSelf: "center" }}
              value={enabledFor("queue.staff", "push")}
              onValueChange={(enabled) => void toggle("queue.staff", "push", enabled)}
            />
          </View>
        </Section>
      ) : null}

      {editableCategories.map((category) => (
        <Section key={category} title={categoryLabel(category, t)}>
          {prefs.channels.map((channel, index) => {
            return (
              <View key={channel}>
                {index > 0 ? <Separator /> : null}
                <View
                  style={{
                    alignItems: "center",
                    flexDirection: "row",
                    minHeight: 50,
                    paddingHorizontal: 16,
                  }}
                >
                  <Text selectable style={{ color: colors.label, flex: 1, fontSize: 16 }}>
                    {channelLabel(channel, t)}
                  </Text>
                  <Switch
                    accessibilityLabel={`${categoryLabel(category, t)}, ${channelLabel(channel, t)}`}
                    disabled={savingKey !== null}
                    style={{ alignSelf: "center" }}
                    value={enabledFor(category, channel)}
                    onValueChange={(enabled) => void toggle(category, channel, enabled)}
                  />
                </View>
              </View>
            );
          })}
        </Section>
      ))}

      <ActionButton
        label={t("refreshNotifications")}
        icon="arrow.clockwise"
        onPress={() => void load()}
      />
    </View>
  );
}

function savePreferences(
  preferences: Array<{ category: string; channel: Channel; enabled: boolean }>,
) {
  return apiFetch<Preferences>("/api/me/notification-preferences", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ preferences }),
  });
}

function payloadField(payload: unknown, key: "subject" | "body") {
  if (!payload || typeof payload !== "object") return null;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value : null;
}

const HIDDEN_PAYLOAD_KEYS = new Set([
  "subject",
  "body",
  "template",
  "vars",
  "recipient",
  "language",
]);

// Technical identifiers (entryId, roomId, activityId, teamId, …) are only
// meaningful to the backend; showing them as raw "Entry Id: 42" rows read as
// ugly, unexplained metadata rather than information a participant can use.
const TECHNICAL_ID_KEY = /(^id$|Id$)/;

function payloadDetails(payload: unknown) {
  if (!payload || typeof payload !== "object") return [];
  return Object.entries(payload as Record<string, unknown>)
    .filter(
      ([key, value]) =>
        !HIDDEN_PAYLOAD_KEYS.has(key) &&
        !TECHNICAL_ID_KEY.test(key) &&
        value !== null &&
        value !== undefined &&
        typeof value !== "object",
    )
    .map(([key, value]) => ({
      key: key
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/^./, (letter) => letter.toUpperCase()),
      value: String(value),
    }));
}

function categoryLabel(category: string, t: ReturnType<typeof useLocale>["t"]) {
  return category === "announcements"
    ? t("notificationsAnnouncements")
    : t("notificationsApplications");
}

function channelLabel(channel: Channel, t: ReturnType<typeof useLocale>["t"]) {
  const labels: Record<Channel, string> = {
    in_app: t("notificationsInApp"),
    email: t("emailLabel"),
    push: t("notificationsPush"),
    discord: "Discord",
  };
  return labels[channel];
}
