import { useLocalSearchParams } from "expo-router";
import Stack from "expo-router/stack";
import { useEffect } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { EmptyState } from "@/components/native-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { StaleDataBanner } from "@/components/stale-data-banner";
import { SymbolView } from "@/components/symbol";
import { useLocale } from "@/lib/i18n";
import { fetchPublicSchedule, scheduleDurationLabel, scheduleTypeLabel } from "@/lib/schedule";
import { useActivityReminders } from "@/lib/use-activity-reminders";
import { useCachedApi } from "@/lib/use-cached-api";
import { colors } from "@/theme/colors";

const CONTENT_PADDING = 20;

export default function ScheduleDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, language } = useLocale();
  const { data, loading, error, staleSince, load } = useCachedApi("schedule", fetchPublicSchedule);
  const reminders = useActivityReminders();

  useEffect(() => {
    void load();
    void reminders.load();
  }, [load, reminders.load]);

  const item = data?.find((candidate) => String(candidate.id) === id) ?? null;
  const reminderOn = item && reminders.ready ? reminders.isEnabled(item.id) : null;
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
  const when = date && time ? `${date} · ${time}` : (date ?? time);

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
                      busy: reminders.savingId === item.id,
                    }}
                    disabled={reminders.savingId === item.id}
                    hitSlop={12}
                    onPress={() => void reminders.toggle(item.id, !reminderOn)}
                    style={{ opacity: reminders.savingId === item.id ? 0.4 : 1 }}
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
          {reminders.error ? (
            <RequestFeedback
              error={reminders.error}
              message={t("scheduleReminderError")}
              onRetry={reminders.retry}
              retrying={reminders.savingId !== null}
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
                <Text
                  style={{
                    color: colors.label,
                    fontSize: 20,
                    fontWeight: "800",
                  }}
                >
                  {t("scheduleDescription")}
                </Text>
                <Text selectable style={{ color: colors.label, fontSize: 16, lineHeight: 24 }}>
                  {item.description}
                </Text>
              </View>
            ) : null}

            <View style={{ gap: 4 }}>
              <Text
                style={{
                  color: colors.label,
                  fontSize: 20,
                  fontWeight: "800",
                  marginBottom: 8,
                }}
              >
                {t("scheduleInformation")}
              </Text>
              <PlainInfoRow label={t("scheduleType")} value={scheduleTypeLabel(item.type, t)} />
              <PlainInfoRow label={t("scheduleDuration")} value={scheduleDurationLabel(item, t)} />
              {when ? <PlainInfoRow label={t("scheduleTime")} value={when} /> : null}
              {item.location ? (
                <PlainInfoRow label={t("scheduleLocation")} value={item.location} last />
              ) : null}
            </View>
          </View>
        )}
      </ScrollView>
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
