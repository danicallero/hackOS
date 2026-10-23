import { CAPABILITIES } from "@hackos/shared/capabilities";
import { useFocusEffect, useNavigation, useRouter } from "expo-router";
import Stack from "expo-router/stack";
import { useCallback, useLayoutEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { ManageAnnouncementsView } from "@/components/announcement-manage-view";
import { AppRefreshControl } from "@/components/app-refresh-control";
import { isRealLiquidGlassAvailable } from "@/components/glass-view";
import {
  InfoRow,
  LegacyHeaderIconButton,
  Section,
  Separator,
  ToggleRow,
} from "@/components/native-ui";
import { PressableFeedback } from "@/components/pressable-feedback";
import { RequestFeedback } from "@/components/RequestFeedback";
import { ScheduleReminderSections, useScheduleReminders } from "@/components/reminders-view";
import { StaleDataBanner } from "@/components/stale-data-banner";
import type { SymbolViewProps } from "@/components/symbol";
import { useLocale } from "@/lib/i18n";
import { useLiveActivitiesSetting } from "@/lib/live-activities/use-live-activities-setting";
import { useLiveActivityKinds } from "@/lib/live-activities/use-live-activity-kinds";
import { useMeContext } from "@/lib/me-context";
import type { NotificationChannel } from "@/lib/notification-preferences";
import { useRouterTabBarScrollBottomInset } from "@/lib/router-tabs-inset";
import { has } from "@/lib/tabs";
import { useHeaderSearch } from "@/lib/use-header-search";
import { useNotificationPreferences } from "@/lib/use-notification-preferences";
import { useParticipantLayout } from "@/theme/layout-participant";

type Translate = ReturnType<typeof useLocale>["t"];

/** Editable notification categories, in display order (H51). */
export type NotificationCategory =
  | "announcements"
  | "schedule"
  | "queue"
  | "challenge"
  | "queue.staff";

const CATEGORY_ICON: Record<NotificationCategory, SymbolViewProps["name"]> = {
  announcements: "megaphone.fill",
  schedule: "calendar.badge.clock",
  queue: "bell",
  challenge: "flag",
  "queue.staff": "door.left.hand.open",
};

export function isNotificationCategory(value: string): value is NotificationCategory {
  return (
    value === "announcements" ||
    value === "schedule" ||
    value === "queue" ||
    value === "challenge" ||
    value === "queue.staff"
  );
}

export function categoryTitle(category: NotificationCategory, t: Translate): string {
  if (category === "announcements") return t("notificationsAnnouncements");
  if (category === "schedule") return t("notificationsActivityReminders");
  if (category === "queue") return t("queueCalls");
  if (category === "challenge") return t("notificationsChallenges");
  return t("notificationsQueueStaff");
}

function channelLabel(channel: NotificationChannel, t: Translate) {
  const labels: Record<NotificationChannel, string> = {
    in_app: t("notificationsInApp"),
    email: t("emailLabel"),
    push: t("notificationsPush"),
  };
  return labels[channel];
}

/** Judges and queue staff receive the opt-in "teams entering rooms" alert. */
function canReceiveQueueStaffAlerts(capabilities: string[]) {
  return (
    has(capabilities, CAPABILITIES.QUEUE_OPERATE) ||
    has(capabilities, CAPABILITIES.QUEUE_ADMIN) ||
    has(capabilities, CAPABILITIES.JUDGE_PANEL)
  );
}

/** Queue staff alerts are push-only and queue calls only let you pick email; the rest offer every channel. */
function categoryChannels(category: NotificationCategory, channels: NotificationChannel[]) {
  if (category === "queue.staff") return channels.filter((channel) => channel === "push");
  if (category === "queue") return channels.filter((channel) => channel === "email");
  return channels;
}

function useScrollContentStyle() {
  const tabBarBottomInset = useRouterTabBarScrollBottomInset();
  const readable = useParticipantLayout("form");
  return {
    gap: 20,
    ...readable.content,
    paddingVertical: 16,
    paddingBottom: Math.max(32, tabBarBottomInset + 16),
  };
}

function NavigationRow({
  label,
  value,
  icon,
  onPress,
}: {
  label: string;
  value: string;
  icon: SymbolViewProps["name"];
  onPress?: () => void;
}) {
  if (!onPress) return <InfoRow icon={icon} label={label} value={value} />;
  return (
    <PressableFeedback
      feedback="opacity"
      accessibilityLabel={`${label}, ${value}`}
      accessibilityRole="button"
      onPress={onPress}
    >
      <InfoRow accessoryIcon="chevron.right" icon={icon} label={label} value={value} />
    </PressableFeedback>
  );
}

/**
 * H51/H59: Account → Notifications. One row per notification type with its
 * current state, the mandatory queue calls, and (ANNOUNCEMENTS_MANAGE) the
 * entry point for sending announcements.
 */
export function NotificationSettingsScreen() {
  const { t } = useLocale();
  const router = useRouter();
  const { me } = useMeContext();
  const preferences = useNotificationPreferences();
  const reminders = useScheduleReminders();
  const liveActivities = useLiveActivitiesSetting();
  // The per-kind screen only while this device shows Live Activities at
  // all: with the master switch off nothing appears here, so it would be inert.
  const liveActivityKinds = useLiveActivityKinds(
    liveActivities.available && liveActivities.enabled,
  );
  const kindsActive = liveActivities.available && liveActivities.enabled;
  const reloadKinds = liveActivityKinds.load;
  // Back from the per-kind screen: refresh its "n of m on" summary.
  useFocusEffect(
    useCallback(() => {
      if (kindsActive) void reloadKinds();
    }, [kindsActive, reloadKinds]),
  );
  const kindsOn = liveActivityKinds.kinds.filter((item) => item.enabled).length;
  const [refreshing, setRefreshing] = useState(false);
  const contentContainerStyle = useScrollContentStyle();
  const capabilities = me?.capabilities ?? [];
  const categories: NotificationCategory[] = [
    "announcements",
    "schedule",
    "queue",
    "challenge",
    ...(canReceiveQueueStaffAlerts(capabilities) ? (["queue.staff"] as const) : []),
  ];
  const canManageAnnouncements = has(capabilities, CAPABILITIES.ANNOUNCEMENTS_MANAGE);

  function summary(category: NotificationCategory) {
    const on = categoryChannels(category, preferences.channels).some((channel) =>
      preferences.enabledFor(category, channel),
    );
    if (!on) return t("alertsOff");
    if (category !== "schedule" || !reminders.notifications.ready) return t("alertsOn");
    const now = Date.now();
    const active = reminders.items.filter(
      (item) => Date.parse(item.endsAt) > now && reminders.notifications.isEntrySubscribed(item),
    ).length;
    return active > 0 ? t("alertsActiveCount", { count: String(active) }) : t("alertsOn");
  }

  async function onRefresh() {
    setRefreshing(true);
    try {
      await Promise.all([preferences.load(), reminders.reload(), liveActivityKinds.load()]);
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={contentContainerStyle}
      refreshControl={
        <AppRefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />
      }
    >
      <StaleDataBanner updatedAt={preferences.staleSince} />
      {!preferences.prefs ? (
        <RequestFeedback
          loading={preferences.loading}
          error={preferences.error}
          onRetry={() => void preferences.load()}
        />
      ) : (
        <>
          <Section title={t("alertsTypes")}>
            {categories.map((category, index) => (
              <View key={category}>
                {index > 0 ? <Separator inset={48} /> : null}
                <NavigationRow
                  label={categoryTitle(category, t)}
                  value={summary(category)}
                  icon={CATEGORY_ICON[category]}
                  onPress={() =>
                    router.push({
                      pathname: "/(tabs)/others/notification-settings/[category]",
                      params: { category },
                    })
                  }
                />
              </View>
            ))}
          </Section>

          {liveActivities.available ? (
            <Section>
              <ToggleRow
                label={t(liveActivities.platform === "android" ? "liveUpdates" : "liveActivities")}
                detail={
                  liveActivityKinds.kinds.length > 0
                    ? t("alertsKindCount", {
                        count: String(kindsOn),
                        total: String(liveActivityKinds.kinds.length),
                      })
                    : undefined
                }
                busy={liveActivities.busy}
                value={liveActivities.enabled}
                onChange={(enabled) => void liveActivities.toggle(enabled)}
                onPress={
                  liveActivityKinds.kinds.length > 0
                    ? () => router.push("/(tabs)/others/notification-settings/live-activities")
                    : undefined
                }
              />
            </Section>
          ) : null}

          {canManageAnnouncements ? (
            <Section title={t("alertsSend")}>
              <NavigationRow
                label={t("notificationsAnnouncements")}
                value=""
                icon="megaphone.fill"
                onPress={() => router.push("/(tabs)/others/announcements")}
              />
            </Section>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

/**
 * H51/H59: one notification type. Channel switches for the whole type; for
 * activity reminders also a bulk switch per activity type and a header search
 * to find one activity.
 */
export function NotificationCategoryScreen({ category }: { category: NotificationCategory }) {
  const { t } = useLocale();
  const preferences = useNotificationPreferences();
  const reminders = useScheduleReminders();
  const query = useHeaderSearch(category === "schedule" ? t("scheduleSearchPlaceholder") : null);
  const [refreshing, setRefreshing] = useState(false);
  const contentContainerStyle = useScrollContentStyle();
  const channels = categoryChannels(category, preferences.channels);
  const title = categoryTitle(category, t);

  async function onRefresh() {
    setRefreshing(true);
    try {
      await Promise.all([
        preferences.load(),
        category === "schedule" ? reminders.reload() : Promise.resolve(),
      ]);
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={contentContainerStyle}
      refreshControl={
        <AppRefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />
      }
    >
      <StaleDataBanner updatedAt={preferences.staleSince} />
      {preferences.actionError ? (
        <RequestFeedback
          error={preferences.actionError}
          onRetry={preferences.retry}
          retrying={preferences.savingKey !== null}
        />
      ) : null}
      {!preferences.prefs ? (
        <RequestFeedback
          loading={preferences.loading}
          error={preferences.error}
          onRetry={() => void preferences.load()}
        />
      ) : (
        <Section
          title={t("alertsChannels")}
          footer={
            category === "queue.staff"
              ? t("notificationsQueueStaffHint")
              : category === "queue"
                ? t("notificationsMandatoryHint")
                : undefined
          }
        >
          {channels.map((channel, index) => (
            <View key={channel}>
              {index > 0 ? <Separator /> : null}
              <ToggleRow
                label={channelLabel(channel, t)}
                accessibilityLabel={`${title}, ${channelLabel(channel, t)}`}
                busy={preferences.savingKey === `${category}:${channel}`}
                value={preferences.enabledFor(category, channel)}
                disabled={channel === "email" && preferences.emailLockedFor(category)}
                onChange={(enabled) => void preferences.toggle(category, channel, enabled)}
              />
            </View>
          ))}
        </Section>
      )}
      {category === "schedule" ? (
        <ScheduleReminderSections reminders={reminders} query={query} />
      ) : null}
    </ScrollView>
  );
}

/** H50: announcement management, reached from Account → Notifications → Send. */
export function AnnouncementsManageScreen() {
  const { t } = useLocale();
  const navigation = useNavigation();
  const [formOpen, setFormOpen] = useState<"create" | number | null>(null);
  const glassAvailable = isRealLiquidGlassAvailable();

  useLayoutEffect(() => {
    if (glassAvailable) return;
    navigation.setOptions({
      headerRight: () => (
        <LegacyHeaderIconButton
          icon="plus"
          accessibilityLabel={t("announcementAdd")}
          onPress={() => setFormOpen("create")}
        />
      ),
    });
  }, [glassAvailable, navigation, t]);

  return (
    <>
      {glassAvailable ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button
            icon="plus"
            accessibilityLabel={t("announcementAdd")}
            onPress={() => setFormOpen("create")}
          />
        </Stack.Toolbar>
      ) : null}
      <ManageAnnouncementsView
        tabSwitcher={null}
        androidTopInset={0}
        formOpen={formOpen}
        onFormOpenChange={setFormOpen}
      />
    </>
  );
}
