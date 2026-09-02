import { useRouter, useScrollToTop } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  RefreshControl,
  ScrollView,
  Text,
  type TextStyle,
  useColorScheme,
  View,
} from "react-native";

import { ActionButton, InfoRow, Section, Separator } from "@/components/native-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { useLocale } from "@/lib/i18n";
import { useMeContext } from "@/lib/me-context";
import { useRouterTabBarScrollBottomInset } from "@/lib/router-tabs-inset";
import { fetchMyScanStats, type MyScanStats } from "@/lib/scan-log";
import { SCAN_LOG_ROUTES } from "@/lib/scan-log-navigation";
import { canViewStaffStatistics } from "@/lib/tabs";
import { useRetryOnReconnect } from "@/lib/use-retry-on-reconnect";
import { colors } from "@/theme/colors";

/** Personal scan statistics and staff operations (H22-H27). */
export default function StatisticsScreen() {
  useColorScheme();
  const router = useRouter();
  const { t } = useLocale();
  const tabBarBottomInset = useRouterTabBarScrollBottomInset();
  const scrollRef = useRef<ScrollView>(null);
  const { me, loading, error, refetch } = useMeContext();
  const [myStats, setMyStats] = useState<MyScanStats | null>(null);
  const [statsError, setStatsError] = useState<Error | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useScrollToTop(scrollRef);

  const canViewStats = canViewStaffStatistics(me?.capabilities ?? []);

  const loadStats = useCallback(async () => {
    if (!canViewStats) {
      setMyStats(null);
      setStatsError(null);
      return;
    }
    setStatsError(null);
    try {
      setMyStats(await fetchMyScanStats());
    } catch (cause) {
      setStatsError(cause instanceof Error ? cause : new Error());
    }
  }, [canViewStats]);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  // No connection yet when this screen first loaded — keep checking instead
  // of leaving the error on screen until the user manually retries.
  useRetryOnReconnect(statsError !== null, loadStats);

  async function onRefresh() {
    setRefreshing(true);
    await Promise.all([refetch(), loadStats()]);
    setRefreshing(false);
  }

  if (loading && !me) {
    return (
      <View style={{ flex: 1, justifyContent: "center" }}>
        <RequestFeedback loading />
      </View>
    );
  }
  if (!me) {
    return (
      <View style={{ flex: 1, justifyContent: "center", padding: 16 }}>
        <RequestFeedback error={error} onRetry={() => void refetch()} />
      </View>
    );
  }
  if (!canViewStats) {
    return (
      <View style={{ flex: 1, justifyContent: "center", padding: 16 }}>
        <RequestFeedback
          error={new Error(t("statisticsStaffOnly"))}
          message={t("statisticsStaffOnly")}
        />
      </View>
    );
  }

  const totalScans = myStats
    ? (myStats.totalCount ??
      (myStats.accreditationCount ?? 0) +
        (myStats.presenceCount ?? 0) +
        (myStats.activityCount ?? 0))
    : null;

  return (
    <ScrollView
      ref={scrollRef}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{
        gap: 22,
        padding: 16,
        paddingBottom: Math.max(32, tabBarBottomInset + 16),
      }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />}
    >
      <Text
        style={{ color: colors.secondaryLabel, fontSize: 15, lineHeight: 21, paddingHorizontal: 4 }}
      >
        {t("statisticsOverviewDescription")}
      </Text>

      {statsError ? (
        <RequestFeedback error={statsError} message={t("statisticsCouldNotLoad")} />
      ) : null}

      {statsError ? null : (
        <>
          <Section title={t("statisticsActivityTitle")} footer={t("statisticsActivityFooter")}>
            <InfoRow
              icon="chart.bar.xaxis"
              label={t("statisticsTotalScans")}
              value={displayCount(totalScans)}
              valueStyle={{ color: colors.label, fontVariant: ["tabular-nums"], fontWeight: "700" }}
            />
            <Separator inset={48} />
            <InfoRow
              icon="person.2.fill"
              label={t("statisticsPeopleReached")}
              value={displayCount(myStats?.uniquePeopleCount)}
              valueStyle={{ color: colors.label, fontVariant: ["tabular-nums"], fontWeight: "700" }}
            />
            <Separator inset={48} />
            <InfoRow
              icon="clock.arrow.circlepath"
              label={t("statisticsLastScan")}
              value={formatLastScan(myStats?.lastScanAt ?? null, t)}
            />
          </Section>

          <Section title={t("statisticsBreakdownTitle")}>
            <InfoRow
              icon="person.badge.key.fill"
              label={t("myStatsAccreditation")}
              value={displayCount(myStats?.accreditationCount)}
              valueStyle={{ color: colors.secondaryLabel, ...countStyle }}
            />
            <Separator inset={48} />
            <InfoRow
              icon="door.left.hand.open"
              label={t("myStatsPresence")}
              value={displayCount(myStats?.presenceCount)}
              valueStyle={{ color: colors.secondaryLabel, ...countStyle }}
            />
            <Separator inset={48} />
            <InfoRow
              icon="list.bullet.rectangle"
              label={t("myStatsActivity")}
              value={displayCount(myStats?.activityCount)}
              valueStyle={{ color: colors.secondaryLabel, ...countStyle }}
            />
          </Section>
        </>
      )}

      <Section title={t("statisticsHistoryTitle")}>
        <ActionButton
          icon="clock.arrow.circlepath"
          label={t("statisticsOpenHistory")}
          onPress={() =>
            router.push({
              pathname: SCAN_LOG_ROUTES.account,
              params: { from: "statistics" },
            })
          }
        />
      </Section>
    </ScrollView>
  );
}

const countStyle: TextStyle = { fontVariant: ["tabular-nums"] };

function displayCount(value: number | null | undefined): string {
  return typeof value === "number" ? String(value) : "—";
}

function formatLastScan(iso: string | null, t: ReturnType<typeof useLocale>["t"]): string {
  if (!iso) return t("statisticsNoScans");
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return t("statisticsNoScans");
  return date.toLocaleString(undefined, {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
  });
}
