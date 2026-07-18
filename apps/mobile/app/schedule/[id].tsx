import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect } from "react";
import { ScrollView, Text, useColorScheme, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { EmptyState, FloatingBackButton, FloatingGlassButton } from "@/components/native-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { StaleDataBanner } from "@/components/stale-data-banner";
import { SymbolView } from "@/components/symbol";
import { useLocale } from "@/lib/i18n";
import { fetchPublicSchedule } from "@/lib/schedule";
import { useActivityReminders } from "@/lib/use-activity-reminders";
import { useCachedApi } from "@/lib/use-cached-api";
import { colors } from "@/theme/colors";

export default function ScheduleDetailScreen() {
  useColorScheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
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

  return (
    <>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          flexGrow: 1,
          gap: 16,
          padding: 20,
          paddingBottom: 40,
          paddingTop: insets.top + 15,
        }}
        style={{ backgroundColor: colors.background }}
      >
        <StaleDataBanner updatedAt={staleSince} />
        {loading && !data ? (
          <RequestFeedback loading />
        ) : error && !data ? (
          <RequestFeedback error={error} onRetry={() => void load()} />
        ) : !item ? (
          <EmptyState
            icon="calendar.badge.exclamationmark"
            title={t("scheduleDetails")}
            description={t("scheduleItemUnavailable")}
          />
        ) : (
          <View style={{ gap: 20 }}>
            <View style={{ gap: 6 }}>
              <View
                style={{ alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 6 }}
              >
                <Text
                  selectable
                  style={{
                    color: colors.secondaryLabel,
                    fontSize: 13,
                    fontWeight: "700",
                    letterSpacing: 0.4,
                    textTransform: "uppercase",
                  }}
                >
                  {item.type ?? t("scheduleDetails")}
                </Text>
                {item.location ? (
                  <>
                    <Text style={{ color: colors.tertiaryLabel, fontSize: 13 }}>·</Text>
                    <Text selectable style={{ color: colors.secondaryLabel, fontSize: 13 }}>
                      {item.location}
                    </Text>
                  </>
                ) : null}
              </View>
              <Text
                selectable
                style={{ color: colors.label, fontSize: 30, fontWeight: "800", lineHeight: 36 }}
              >
                {item.title}
              </Text>
            </View>

            <View
              style={{
                alignItems: "center",
                alignSelf: "flex-start",
                backgroundColor: colors.accentSurface,
                borderCurve: "continuous",
                borderRadius: 999,
                flexDirection: "row",
                gap: 8,
                paddingHorizontal: 14,
                paddingVertical: 10,
              }}
            >
              <SymbolView
                name="clock.fill"
                tintColor={colors.accent}
                size={15}
                accessible={false}
              />
              <Text selectable style={{ color: colors.accent, fontSize: 15, fontWeight: "700" }}>
                {date ? `${date} · ${time}` : time}
              </Text>
            </View>

            {item.description ? (
              <View style={{ gap: 6 }}>
                <Text
                  style={{
                    color: colors.secondaryLabel,
                    fontSize: 12,
                    fontWeight: "700",
                    letterSpacing: 0.4,
                    textTransform: "uppercase",
                  }}
                >
                  {t("scheduleDescription")}
                </Text>
                <Text selectable style={{ color: colors.label, fontSize: 16, lineHeight: 24 }}>
                  {item.description}
                </Text>
              </View>
            ) : null}
          </View>
        )}
      </ScrollView>
      <FloatingBackButton top={insets.top + 8} onPress={() => router.back()} />
      {item && reminderOn !== null ? (
        <FloatingGlassButton
          top={insets.top + 8}
          side="right"
          icon={reminderOn ? "bell.fill" : "bell"}
          tintColor={reminderOn ? colors.accent : colors.label}
          accessibilityLabel={t(reminderOn ? "scheduleReminderOn" : "scheduleReminderOff", {
            name: item.title,
          })}
          accessibilityState={{ selected: reminderOn, busy: reminders.savingId === item.id }}
          disabled={reminders.savingId === item.id}
          onPress={() => void reminders.toggle(item.id, !reminderOn)}
        />
      ) : null}
    </>
  );
}
