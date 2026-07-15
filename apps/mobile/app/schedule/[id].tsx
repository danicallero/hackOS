import { Stack, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useEffect } from "react";
import { ScrollView, Text, useColorScheme, View } from "react-native";

import { EmptyState, StatusPill } from "@/components/native-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { StaleDataBanner } from "@/components/stale-data-banner";
import { useLocale } from "@/lib/i18n";
import { fetchPublicSchedule } from "@/lib/schedule";
import { useCachedApi } from "@/lib/use-cached-api";
import { colors } from "@/theme/colors";

export default function ScheduleDetailScreen() {
  useColorScheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, language } = useLocale();
  const { data, loading, error, staleSince, load } = useCachedApi(
    "schedule",
    fetchPublicSchedule,
  );

  useEffect(() => {
    void load();
  }, [load]);

  const item = data?.find((candidate) => String(candidate.id) === id) ?? null;
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
        contentContainerStyle={{ flexGrow: 1, gap: 16, padding: 20, paddingBottom: 40 }}
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
          <View style={{ gap: 16 }}>
            {item.type ? (
              <View style={{ alignItems: "flex-start" }}>
                <StatusPill>{item.type}</StatusPill>
              </View>
            ) : null}
            <DetailRow icon="clock" label={t("scheduleTime")}>
              {date ? `${date} · ${time}` : time}
            </DetailRow>
            {item.location ? (
              <DetailRow icon="mappin.and.ellipse" label={t("scheduleLocation")}>
                {item.location}
              </DetailRow>
            ) : null}
            {item.description ? (
              <View
                style={{
                  backgroundColor: colors.surface,
                  borderCurve: "continuous",
                  borderRadius: 14,
                  gap: 8,
                  padding: 16,
                }}
              >
                <Text selectable style={{ color: colors.secondaryLabel, fontSize: 13 }}>
                  {t("scheduleDescription")}
                </Text>
                <Text
                  selectable
                  style={{ color: colors.label, fontSize: 16, lineHeight: 23 }}
                >
                  {item.description}
                </Text>
              </View>
            ) : null}
          </View>
        )}
      </ScrollView>
      <Stack.Title>{item?.title ?? t("scheduleDetails")}</Stack.Title>
    </>
  );
}

function DetailRow({
  children,
  icon,
  label,
}: {
  children: React.ReactNode;
  icon: "clock" | "mappin.and.ellipse";
  label: string;
}) {
  return (
    <View
      style={{
        alignItems: "flex-start",
        backgroundColor: colors.surface,
        borderCurve: "continuous",
        borderRadius: 14,
        flexDirection: "row",
        gap: 12,
        padding: 16,
      }}
    >
      <SymbolView name={icon} tintColor={colors.secondaryLabel} size={20} accessible={false} />
      <View style={{ flex: 1, gap: 3 }}>
        <Text selectable style={{ color: colors.secondaryLabel, fontSize: 13 }}>
          {label}
        </Text>
        <Text selectable style={{ color: colors.label, fontSize: 16, lineHeight: 22 }}>
          {children}
        </Text>
      </View>
    </View>
  );
}
