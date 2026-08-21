import { CAPABILITIES } from "@hackos/shared/capabilities";
import { useLocalSearchParams } from "expo-router";
import Stack from "expo-router/stack";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GlassView } from "@/components/glass-view";
import { EmptyState } from "@/components/native-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { ScheduleFormModal, scheduleItemToForm } from "@/components/schedule-form-modal";
import { StaleDataBanner } from "@/components/stale-data-banner";
import { SymbolView } from "@/components/symbol";
import { useLocale } from "@/lib/i18n";
import { useMeContext } from "@/lib/me-context";
import {
  type AdminScheduleItem,
  collapseBlankLines,
  fetchAdminSchedule,
  fetchPublicSchedule,
  type ScheduleInput,
  scheduleDurationLabel,
  scheduleTypeLabel,
  updateScheduleItem,
} from "@/lib/schedule";
import { has } from "@/lib/tabs";
import { useCachedApi } from "@/lib/use-cached-api";
import { itemCategory, useScheduleNotifications } from "@/lib/use-schedule-notifications";
import { colors } from "@/theme/colors";

const CONTENT_PADDING = 20;

const sectionHeaderStyle = {
  color: colors.secondaryLabel,
  fontSize: 13,
  fontWeight: "600" as const,
  textTransform: "uppercase" as const,
};

export default function ScheduleDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, language } = useLocale();
  const { me } = useMeContext();
  const insets = useSafeAreaInsets();
  const canManage = has(me?.capabilities ?? [], CAPABILITIES.SCHEDULE_MANAGE);
  const { data, loading, error, staleSince, load } = useCachedApi("schedule", fetchPublicSchedule);
  const notifications = useScheduleNotifications(data ?? []);
  const [editing, setEditing] = useState(false);
  const [adminItem, setAdminItem] = useState<AdminScheduleItem | null>(null);

  useEffect(() => {
    void load();
    void notifications.load();
  }, [load, notifications.load]);

  useEffect(() => {
    if (!editing) return;
    let cancelled = false;
    void fetchAdminSchedule().then((items) => {
      if (cancelled) return;
      const match = items.find((candidate) => String(candidate.id) === id);
      if (match) setAdminItem(match);
    });
    return () => {
      cancelled = true;
    };
  }, [editing, id]);

  const item = data?.find((candidate) => String(candidate.id) === id) ?? null;
  const reminderOn = item && notifications.ready ? notifications.isEntrySubscribed(item) : null;

  async function saveEdit(values: ScheduleInput, _pendingOwnerIds: number[]) {
    if (!item) return;
    await updateScheduleItem(item.id, values);
    setEditing(false);
    setAdminItem(null);
    await load();
  }
  const startsAt = item ? new Date(item.startsAt) : null;
  const endsAt = item ? new Date(item.endsAt) : null;
  const date = startsAt?.toLocaleDateString(language, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const time =
    startsAt && endsAt
      ? `${startsAt.toLocaleTimeString(language, { hour: "2-digit", minute: "2-digit" })}–${endsAt.toLocaleTimeString(language, { hour: "2-digit", minute: "2-digit" })}`
      : null;

  return (
    <>
      <Stack.Screen
        options={{
          title: item?.title ?? "",
          headerRight:
            item && reminderOn !== null
              ? () => (
                  <Pressable
                    accessibilityLabel={t(
                      reminderOn ? "scheduleReminderOn" : "scheduleReminderOff",
                      {
                        name: item.title,
                      },
                    )}
                    accessibilityRole="button"
                    accessibilityState={{
                      selected: reminderOn,
                      busy: notifications.savingKey === itemCategory(item.id),
                    }}
                    disabled={notifications.savingKey === itemCategory(item.id)}
                    hitSlop={12}
                    onPress={() => void notifications.toggleEntry(item)}
                    style={{
                      opacity: notifications.savingKey === itemCategory(item.id) ? 0.4 : 1,
                    }}
                  >
                    <SymbolView
                      name={reminderOn ? "bell.fill" : "bell"}
                      tintColor={reminderOn ? colors.accent : colors.label}
                      size={20}
                    />
                  </Pressable>
                )
              : undefined,
        }}
      />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          flexGrow: 1,
          paddingBottom: 40,
          paddingHorizontal: CONTENT_PADDING,
        }}
        style={{ backgroundColor: colors.background }}
      >
        <View style={{ gap: 8 }}>
          <StaleDataBanner updatedAt={staleSince} onRetry={() => void load()} retrying={loading} />
          {notifications.error ? (
            <RequestFeedback
              error={notifications.error}
              message={t("scheduleReminderError")}
              onRetry={notifications.retry}
              retrying={notifications.savingKey !== null}
            />
          ) : null}
        </View>

        {!item ? (
          loading && !data ? (
            <RequestFeedback loading />
          ) : error && !data ? (
            <RequestFeedback error={error} onRetry={() => void load()} />
          ) : (
            <EmptyState
              icon="calendar.badge.exclamationmark"
              title={t("scheduleDetails")}
              description={t("scheduleItemUnavailable")}
            />
          )
        ) : (
          <View style={{ gap: 24 }}>
            {item.description ? (
              <View style={{ gap: 10 }}>
                <Text style={sectionHeaderStyle}>{t("scheduleDescription")}</Text>
                <Text selectable style={{ color: colors.label, fontSize: 16, lineHeight: 24 }}>
                  {collapseBlankLines(item.description)}
                </Text>
              </View>
            ) : null}

            <View style={{ gap: 8 }}>
              <Text style={sectionHeaderStyle}>{t("scheduleInformation")}</Text>
              <View
                style={{
                  backgroundColor: colors.surface,
                  borderCurve: "continuous",
                  borderRadius: 14,
                  paddingHorizontal: 16,
                }}
              >
                <PlainInfoRow label={t("scheduleType")} value={scheduleTypeLabel(item.type, t)} />
                <PlainInfoRow
                  label={t("scheduleDuration")}
                  value={scheduleDurationLabel(item, t)}
                />
                {date ? <PlainInfoRow label={t("scheduleDate")} value={date} /> : null}
                {time ? <PlainInfoRow label={t("scheduleTime")} value={time} /> : null}
                {item.location ? (
                  <PlainInfoRow label={t("scheduleLocation")} value={item.location} last />
                ) : null}
              </View>
            </View>
          </View>
        )}
      </ScrollView>

      {canManage && item ? (
        <GlassView
          glassEffectStyle="regular"
          isInteractive
          style={{
            borderRadius: 26,
            bottom: Math.max(16, insets.bottom),
            height: 52,
            position: "absolute",
            right: 16,
            width: 52,
          }}
        >
          <Pressable
            accessibilityLabel={t("scheduleEdit")}
            accessibilityRole="button"
            onPress={() => setEditing(true)}
            style={{ alignItems: "center", flex: 1, justifyContent: "center" }}
          >
            <SymbolView name="pencil" tintColor={colors.accent} size={20} weight="semibold" />
          </Pressable>
        </GlassView>
      ) : null}

      {editing && adminItem ? (
        <ScheduleFormModal
          visible
          onClose={() => {
            setEditing(false);
            setAdminItem(null);
          }}
          initial={scheduleItemToForm(adminItem)}
          scheduleId={adminItem.id}
          initialOwners={adminItem.owners}
          onSubmit={saveEdit}
        />
      ) : null}
    </>
  );
}

/** Full-bleed label/value row, no card — mirrors Podcasts' plain "Information" list. */
function PlainInfoRow({
  label,
  value,
  last = false,
}: {
  label: string;
  value: string;
  last?: boolean;
}) {
  return (
    <View
      style={{
        alignItems: "center",
        borderBottomColor: colors.separator,
        borderBottomWidth: last ? 0 : 0.5,
        flexDirection: "row",
        justifyContent: "space-between",
        paddingVertical: 14,
      }}
    >
      <Text selectable style={{ color: colors.secondaryLabel, fontSize: 16 }}>
        {label}
      </Text>
      <Text selectable style={{ color: colors.label, fontSize: 16 }}>
        {value}
      </Text>
    </View>
  );
}
