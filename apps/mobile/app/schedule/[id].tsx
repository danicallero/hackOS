import { BlurView } from "expo-blur";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect } from "react";
import { ScrollView, Text, useColorScheme, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AdaptiveBackButton, AdaptiveToolbarButton, EmptyState } from "@/components/native-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { StaleDataBanner } from "@/components/stale-data-banner";
import { useLocale } from "@/lib/i18n";
import { fetchPublicSchedule, scheduleDurationLabel, scheduleTypeLabel } from "@/lib/schedule";
import { useActivityReminders } from "@/lib/use-activity-reminders";
import { useAndroidTopInset } from "@/lib/use-android-top-inset";
import { useCachedApi } from "@/lib/use-cached-api";
import { colors } from "@/theme/colors";

const CONTENT_PADDING = 20;
// The floating back/reminder buttons sit at `topInset + 8` with a 44pt
// diameter — the header's own text has to clear that whole row.
const BUTTON_ROW_HEIGHT = 60;
// Approximate height of the header's own title + subtitle text, so the
// scrolling content below starts clear of it instead of underneath it.
const HEADER_TEXT_HEIGHT = 56;

export default function ScheduleDetailScreen() {
  const colorScheme = useColorScheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const androidTopInset = useAndroidTopInset();
  const topInset = process.env.EXPO_OS === "ios" ? insets.top : androidTopInset;
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
  // Everything the header already shows (location, when it happens) is left
  // out of the Information table below so nothing repeats.
  const headerSubtitle = [item?.location, when].filter(Boolean).join(" · ");
  const headerHeight = topInset + BUTTON_ROW_HEIGHT + HEADER_TEXT_HEIGHT;

  return (
    <>
      <ScrollView
        // A fixed sibling overlay below (not scroll content) — `stickyHeaderIndices`
        // pins content visually, but RN's JS implementation lets it drag along
        // with the elastic bounce when you overscroll past the top. A sibling
        // outside the ScrollView's transform hierarchy can't move at all.
        scrollIndicatorInsets={{
          top: item ? headerHeight : topInset + BUTTON_ROW_HEIGHT,
        }}
        contentContainerStyle={{
          flexGrow: 1,
          paddingBottom: 40,
          paddingHorizontal: CONTENT_PADDING,
          paddingTop: item ? headerHeight : topInset + BUTTON_ROW_HEIGHT,
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
              <PlainInfoRow
                label={t("scheduleDuration")}
                value={scheduleDurationLabel(item, t)}
                last
              />
            </View>
          </View>
        )}
      </ScrollView>

      {item ? (
        <View
          pointerEvents="none"
          style={{
            height: headerHeight,
            left: 0,
            position: "absolute",
            right: 0,
            top: 0,
          }}
        >
          <BlurView
            intensity={9}
            tint={colorScheme === "dark" ? "dark" : "light"}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: headerHeight,
            }}
          />
          <View
            style={{
              left: 0,
              paddingHorizontal: CONTENT_PADDING,
              paddingTop: topInset + BUTTON_ROW_HEIGHT,
              position: "absolute",
              right: 0,
              top: 0,
            }}
          >
            <Text
              selectable
              numberOfLines={1}
              style={{ color: colors.label, fontSize: 22, fontWeight: "800" }}
            >
              {item.title}
            </Text>
            {headerSubtitle ? (
              <Text
                selectable
                numberOfLines={1}
                style={{
                  color: colors.secondaryLabel,
                  fontSize: 14,
                  marginTop: 2,
                }}
              >
                {headerSubtitle}
              </Text>
            ) : null}
          </View>
        </View>
      ) : null}

      <AdaptiveBackButton top={insets.top + 8} onPress={() => router.back()} />
      {item && reminderOn !== null ? (
        <AdaptiveToolbarButton
          top={insets.top + 8}
          side="right"
          icon={reminderOn ? "bell.fill" : "bell"}
          tintColor={reminderOn ? colors.accent : colors.label}
          accessibilityLabel={t(reminderOn ? "scheduleReminderOn" : "scheduleReminderOff", {
            name: item.title,
          })}
          accessibilityState={{
            selected: reminderOn,
            busy: reminders.savingId === item.id,
          }}
          disabled={reminders.savingId === item.id}
          onPress={() => void reminders.toggle(item.id, !reminderOn)}
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
