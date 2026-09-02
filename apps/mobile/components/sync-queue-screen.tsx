import { useScrollToTop } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  type TextStyle,
  View,
} from "react-native";

import {
  ActionButton,
  EmptyState,
  InfoRow,
  Section,
  Separator,
  StatusPill,
} from "@/components/native-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import {
  detailLabel,
  ManualLogDetails,
  scannerOperationLabel,
  subjectLabel,
} from "@/components/scanner-transaction-status";
import { SegmentedControl } from "@/components/segmented-control";
import { StaleDataBanner } from "@/components/stale-data-banner";
import { SymbolView } from "@/components/symbol";
import { haptic } from "@/lib/haptics";
import { useLocale } from "@/lib/i18n";
import { useMeContext } from "@/lib/me-context";
import { useRouterTabBarScrollBottomInset } from "@/lib/router-tabs-inset";
import { listScannerActivities, listScannerPeople } from "@/lib/scanner-db";
import type {
  PendingScan,
  ScannerActivity,
  ScannerPerson,
  ScannerSyncErrorEntry,
} from "@/lib/scanner-types";
import { canViewStaffStatistics, isOperator } from "@/lib/tabs";
import { useScannerSync } from "@/lib/use-scanner";
import { colors } from "@/theme/colors";

type QueueFilter = "all" | "errors" | "waiting" | "confirmed";

/** Full local reconciliation and replay-error history for scanner staff. */
export default function SyncQueueScreen() {
  const { t } = useLocale();
  const { me, loading, error, refetch } = useMeContext();
  const sync = useScannerSync();
  const scrollRef = useRef<ScrollView>(null);
  const tabBarBottomInset = useRouterTabBarScrollBottomInset();
  const [filter, setFilter] = useState<QueueFilter>("all");
  const [people, setPeople] = useState<ScannerPerson[]>([]);
  const [activities, setActivities] = useState<ScannerActivity[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  useScrollToTop(scrollRef);

  async function onRefresh() {
    setRefreshing(true);
    try {
      await sync.sync();
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    // The local roster can be replaced by a completed sync, so keep the
    // labels beside queued activity scans in step with that snapshot.
    void sync.lastSync;
    void sync.queue.length;
    void Promise.all([listScannerPeople(), listScannerActivities()]).then(
      ([nextPeople, nextActivities]) => {
        setPeople(nextPeople);
        setActivities(nextActivities);
      },
    );
  }, [sync.lastSync, sync.queue.length]);

  const canViewStats = canViewStaffStatistics(me?.capabilities ?? []);
  const canManage = me ? isOperator(me.capabilities) : false;

  const queue = useMemo(() => {
    const current = [...sync.queue].reverse();
    if (filter === "errors") {
      return current.filter((scan) => scan.status === "failed" || scan.lastError);
    }
    if (filter === "waiting") return current.filter((scan) => scan.status === "pending");
    if (filter === "confirmed") {
      return current.filter((scan) => scan.status === "acknowledged");
    }
    return current;
  }, [filter, sync.queue]);

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

  const health = queueHealth(sync.queue);
  const failedCount = sync.queue.filter((scan) => scan.status === "failed").length;
  const syncError = sync.autoRetryPaused && sync.error ? sync.error : null;

  function discard(id: string) {
    Alert.alert(t("scannerDiscardScanTitle"), t("scannerDiscardScanBody"), [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("scannerDiscardScan"),
        style: "destructive",
        onPress: () => {
          void haptic("warning");
          void sync.discardScan(id);
        },
      },
    ]);
  }

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
        {t("scannerSyncQueueDescription")}
      </Text>

      {syncError?.conflict ? (
        <RequestFeedback
          error={new Error(syncError.message)}
          message={t("scannerSyncRejected")}
          onRetry={() => void sync.sync()}
          retrying={sync.syncing}
        />
      ) : null}
      {syncError && !syncError.conflict ? <StaleDataBanner updatedAt={sync.lastSync} /> : null}

      <Section title={t("scannerReconciliationTitle")}>
        <InfoRow
          icon="arrow.down.circle"
          label={t("scannerQueueWaiting")}
          value={String(health.waiting)}
          valueStyle={{
            color: health.waiting > 0 ? colors.warning : colors.secondaryLabel,
            ...numberStyle,
          }}
        />
        <Separator inset={48} />
        <InfoRow
          icon="exclamationmark.triangle"
          label={t("scannerQueueNeedsAttention")}
          value={String(health.errors)}
          valueStyle={{
            color: health.errors > 0 ? colors.destructive : colors.secondaryLabel,
            ...numberStyle,
          }}
        />
        <Separator inset={48} />
        <InfoRow
          icon="checkmark.circle"
          label={t("scannerQueueConfirmed")}
          value={String(health.confirmed)}
          valueStyle={{ color: colors.success, ...numberStyle }}
        />
        <Separator inset={48} />
        <InfoRow
          icon="clock"
          label={t("scannerQueueLastSync")}
          value={formatDateTime(sync.lastSync, t("scannerNeverSynced"))}
        />
        <Separator />
        <ActionButton
          icon="arrow.triangle.2.circlepath"
          label={t("scannerSync")}
          busy={sync.syncing}
          onPress={() => void sync.sync()}
        />
        {failedCount > 0 ? (
          <ActionButton
            icon="arrow.clockwise"
            label={t("scannerRetryFailed")}
            busy={sync.syncing}
            onPress={() => void sync.retryFailed()}
          />
        ) : null}
      </Section>

      <View style={{ gap: 8 }}>
        <Text
          accessibilityRole="header"
          style={{
            color: colors.secondaryLabel,
            fontSize: 13,
            fontWeight: "600",
            paddingHorizontal: 16,
          }}
        >
          {t("scannerCurrentQueue")}
        </Text>
        <SegmentedControl
          label={t("scannerQueueFilter")}
          values={[
            t("scannerQueueFilterAll"),
            t("scannerQueueFilterErrors"),
            t("scannerQueueFilterWaiting"),
            t("scannerQueueFilterConfirmed"),
          ]}
          selectedIndex={FILTERS.indexOf(filter)}
          onChange={(index) => setFilter(FILTERS[index] ?? "all")}
        />
      </View>

      {queue.length === 0 ? (
        <Section>
          <EmptyState
            icon={filter === "errors" ? "checkmark.circle" : "arrow.triangle.2.circlepath"}
            title={filter === "errors" ? t("scannerNoSyncErrors") : t("scannerNoQueue")}
            description={
              filter === "errors"
                ? t("scannerNoSyncErrorsDescription")
                : t("scannerNoQueueDescription")
            }
          />
        </Section>
      ) : (
        <Section>
          {queue.map((scan, index) => (
            <View key={scan.id}>
              {index > 0 ? <Separator inset={16} /> : null}
              <QueueRow
                activities={activities}
                canManage={canManage}
                people={people}
                scan={scan}
                onDiscard={() => discard(scan.id)}
                onRetry={() => void sync.retryOne(scan.id)}
              />
            </View>
          ))}
        </Section>
      )}

      <Section title={t("scannerErrorHistoryTitle")} footer={t("scannerErrorHistoryFooter")}>
        {sync.errorHistory.length === 0 ? (
          <Text style={{ color: colors.secondaryLabel, fontSize: 14, lineHeight: 19, padding: 16 }}>
            {t("scannerNoSyncErrorsDescription")}
          </Text>
        ) : (
          sync.errorHistory.map((entry, index) => (
            <View key={entry.id}>
              {index > 0 ? <Separator inset={16} /> : null}
              <ErrorHistoryRow
                activities={activities}
                entry={entry}
                people={people}
                scan={sync.queue.find((queuedScan) => queuedScan.id === entry.scanId)}
              />
            </View>
          ))
        )}
      </Section>
    </ScrollView>
  );
}

const FILTERS: QueueFilter[] = ["all", "errors", "waiting", "confirmed"];
const numberStyle: TextStyle = { fontVariant: ["tabular-nums"], fontWeight: "700" };

function queueHealth(queue: PendingScan[]) {
  return queue.reduce(
    (health, scan) => {
      if (scan.status === "failed") {
        health.errors += 1;
      } else if (scan.status === "pending") {
        health.waiting += 1;
        if (scan.lastError) health.errors += 1;
      } else {
        health.confirmed += 1;
      }
      return health;
    },
    { waiting: 0, errors: 0, confirmed: 0 },
  );
}

function QueueRow({
  scan,
  people,
  activities,
  canManage,
  onRetry,
  onDiscard,
}: {
  scan: PendingScan;
  people: ScannerPerson[];
  activities: ScannerActivity[];
  canManage: boolean;
  onRetry: () => void;
  onDiscard: () => void;
}) {
  const { t } = useLocale();
  const subject = subjectLabel(scan, people);
  const status = queueStatus(scan, t);
  return (
    <View style={{ gap: 8, padding: 16 }}>
      <View style={{ alignItems: "center", flexDirection: "row", gap: 10 }}>
        <SymbolView name={status.icon} tintColor={status.color} size={19} accessible={false} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text numberOfLines={1} style={{ color: colors.label, fontSize: 15, fontWeight: "700" }}>
            {subject ?? scannerOperationLabel(scan, t)}
          </Text>
          <Text
            numberOfLines={2}
            style={{ color: colors.secondaryLabel, fontSize: 13, lineHeight: 18 }}
          >
            {scannerOperationLabel(scan, t)} · {detailLabel(scan, activities, t)}
          </Text>
        </View>
        <StatusPill tone={status.tone}>{status.label}</StatusPill>
      </View>
      <Text style={{ color: colors.tertiaryLabel, fontSize: 12, paddingLeft: 29 }}>
        {formatDateTime(scan.createdAt, "")}
        {scan.attempts > 0
          ? ` · ${t("scannerAttemptsCount", { count: String(scan.attempts) })}`
          : ""}
      </Text>
      {scan.lastError ? (
        <Text
          accessibilityRole="alert"
          selectable
          style={{ color: colors.destructive, fontSize: 13, lineHeight: 18, paddingLeft: 29 }}
        >
          {scan.status === "failed" ? scan.lastError : t("scannerOfflineWaiting")}
        </Text>
      ) : null}
      {scan.status === "failed" || scan.lastError ? (
        <View style={{ gap: 6, marginTop: 4, paddingLeft: 29 }}>
          <Text style={{ color: colors.secondaryLabel, fontSize: 12, fontWeight: "700" }}>
            {t("scannerReconciliationDetails")}
          </Text>
          <ManualLogDetails activities={activities} people={people} scan={scan} showHint={false} />
        </View>
      ) : null}
      {scan.status === "failed" && canManage ? (
        <View style={{ flexDirection: "row", gap: 8, justifyContent: "flex-end", paddingLeft: 29 }}>
          <CompactAction icon="arrow.clockwise" label={t("retry")} onPress={onRetry} />
          <CompactAction
            destructive
            icon="trash"
            label={t("scannerDiscardScan")}
            onPress={onDiscard}
          />
        </View>
      ) : null}
    </View>
  );
}

function ErrorHistoryRow({
  entry,
  scan,
  people,
  activities,
}: {
  entry: ScannerSyncErrorEntry;
  scan?: PendingScan;
  people: ScannerPerson[];
  activities: ScannerActivity[];
}) {
  const { t } = useLocale();
  const context = scan
    ? `${subjectLabel(scan, people) ?? scannerOperationLabel(scan, t)} · ${detailLabel(scan, activities, t)}`
    : null;
  return (
    <View style={{ gap: 5, padding: 16 }}>
      <View style={{ alignItems: "center", flexDirection: "row", gap: 8 }}>
        <SymbolView
          accessible={false}
          name={entry.type === "rejected" ? "xmark.circle" : "arrow.clockwise"}
          size={17}
          tintColor={entry.type === "rejected" ? colors.destructive : colors.warning}
        />
        <Text style={{ color: colors.label, flex: 1, fontSize: 14, fontWeight: "700" }}>
          {t(entry.type === "rejected" ? "scannerErrorRejected" : "scannerErrorRetryable")}
        </Text>
        <Text style={{ color: colors.tertiaryLabel, fontSize: 12 }}>
          {formatDateTime(entry.occurredAt, "")}
        </Text>
      </View>
      <Text
        selectable
        style={{ color: colors.secondaryLabel, fontSize: 13, lineHeight: 18, paddingLeft: 25 }}
      >
        {entry.message}
      </Text>
      {context ? (
        <Text
          style={{ color: colors.tertiaryLabel, fontSize: 12, lineHeight: 17, paddingLeft: 25 }}
        >
          {context}
        </Text>
      ) : null}
      <Text style={{ color: colors.tertiaryLabel, fontSize: 12, paddingLeft: 25 }}>
        {t("scannerErrorScanId", { id: entry.scanId })}
      </Text>
    </View>
  );
}

function CompactAction({
  label,
  icon,
  onPress,
  destructive = false,
}: {
  label: string;
  icon: "arrow.clockwise" | "trash";
  onPress: () => void;
  destructive?: boolean;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={() => {
        void haptic("light");
        onPress();
      }}
      style={({ pressed }) => ({
        alignItems: "center",
        borderColor: destructive ? colors.destructive : colors.separator,
        borderCurve: "continuous",
        borderRadius: 9,
        borderWidth: 1,
        flexDirection: "row",
        gap: 5,
        minHeight: 40,
        opacity: pressed ? 0.6 : 1,
        paddingHorizontal: 12,
      })}
    >
      <SymbolView
        name={icon}
        tintColor={destructive ? colors.destructive : colors.accent}
        size={14}
        accessible={false}
      />
      <Text
        style={{
          color: destructive ? colors.destructive : colors.accent,
          fontSize: 13,
          fontWeight: "600",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function queueStatus(scan: PendingScan, t: ReturnType<typeof useLocale>["t"]) {
  if (scan.status === "failed") {
    return {
      color: colors.destructive,
      icon: "exclamationmark.triangle.fill" as const,
      label: t("scannerStateAttention"),
      tone: "destructive" as const,
    };
  }
  if (scan.status === "pending" && scan.lastError) {
    return {
      color: colors.warning,
      icon: "arrow.clockwise" as const,
      label: t("scannerStateRetrying"),
      tone: "warning" as const,
    };
  }
  if (scan.status === "pending") {
    return {
      color: colors.warning,
      icon: "internaldrive.fill" as const,
      label: t("scannerStateSaved"),
      tone: "warning" as const,
    };
  }
  return {
    color: colors.success,
    icon: "checkmark.circle.fill" as const,
    label: t("scannerStateConfirmed"),
    tone: "success" as const,
  };
}

function formatDateTime(iso: string | null, fallback: string): string {
  if (!iso) return fallback;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleString(undefined, {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
  });
}
