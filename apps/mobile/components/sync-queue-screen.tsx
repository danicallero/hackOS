import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, Text, type TextStyle, View } from "react-native";
import { AppRefreshControl } from "@/components/app-refresh-control";
import { FilterMenu } from "@/components/filter-menu";
import {
  ActionButton,
  EmptyState,
  InfoRow,
  Section,
  Separator,
  StatusPill,
} from "@/components/native-ui";
import { PressableFeedback } from "@/components/pressable-feedback";
import { RequestFeedback } from "@/components/RequestFeedback";
import {
  buildPeopleIndex,
  detailLabel,
  ManualLogDetails,
  type PeopleLookup,
  scannerOperationLabel,
  subjectLabel,
} from "@/components/scanner-transaction-status";
import { StaleDataBanner } from "@/components/stale-data-banner";
import { SymbolView } from "@/components/symbol";
import { alert } from "@/lib/alert";
import { scanFailureText } from "@/lib/api-error-reason";
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
import { useTrueTopScroll } from "@/lib/use-true-top-scroll";
import { radius, type } from "@/theme";
import { colors } from "@/theme/colors";
import { useOperatorListColumn } from "@/theme/layout-screens";

type QueueFilter = "all" | "errors" | "waiting" | "confirmed";

/** Full local reconciliation and replay-error history for scanner staff. */
export default function SyncQueueScreen() {
  const listColumn = useOperatorListColumn();
  const { t } = useLocale();
  const { me, loading, error, refetch } = useMeContext();
  const sync = useScannerSync();
  const scrollRef = useRef<ScrollView>(null);
  const tabBarBottomInset = useRouterTabBarScrollBottomInset();
  const [filters, setFilters] = useState<Exclude<QueueFilter, "all">[]>([]);
  const [people, setPeople] = useState<ScannerPerson[]>([]);
  const [activities, setActivities] = useState<ScannerActivity[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const trueTop = useTrueTopScroll(scrollRef);

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
    if (filters.length === 0) return current;
    return current.filter(
      (scan) =>
        (filters.includes("errors") && (scan.status === "failed" || Boolean(scan.lastError))) ||
        (filters.includes("waiting") && scan.status === "pending") ||
        (filters.includes("confirmed") && scan.status === "acknowledged"),
    );
  }, [filters, sync.queue]);
  const onlyErrors = filters.length === 1 && filters[0] === "errors";

  // O(1) lookups shared by every row instead of each one scanning the full
  // roster/activity list/queue on its own — this screen can show hundreds of
  // queued scans after a device was offline for a while.
  const peopleIndex = useMemo(() => buildPeopleIndex(people), [people]);
  const activitiesById = useMemo(
    () => new Map(activities.map((activity) => [activity.id, activity])),
    [activities],
  );
  const queueById = useMemo(() => new Map(sync.queue.map((scan) => [scan.id, scan])), [sync.queue]);

  const discard = useCallback(
    (id: string) => {
      alert(t("scannerDiscardScanTitle"), t("scannerDiscardScanBody"), [
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
    },
    [t, sync.discardScan],
  );

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

  return (
    <ScrollView
      ref={scrollRef}
      {...trueTop.scrollProps}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{
        ...listColumn,
        gap: 22,
        paddingTop: 16,
        paddingBottom: Math.max(32, tabBarBottomInset + 16),
      }}
      refreshControl={
        <AppRefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />
      }
    >
      <Text
        style={{
          ...type.subhead,
          color: colors.secondaryLabel,
          lineHeight: 21,
          paddingHorizontal: 4,
        }}
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

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
        }}
      >
        <Text
          accessibilityRole="header"
          style={{
            ...type.footnote,
            color: colors.secondaryLabel,

            fontWeight: "600",
            paddingHorizontal: 16,
          }}
        >
          {t("scannerCurrentQueue")}
        </Text>
        <FilterMenu
          accessibilityLabel={t("scannerQueueFilter")}
          active={filters.length > 0}
          items={[
            { id: "all", label: t("scannerQueueFilterAll"), selected: filters.length === 0 },
            {
              id: "errors",
              label: t("scannerQueueFilterErrors"),
              selected: filters.includes("errors"),
              icon: "exclamationmark.triangle",
            },
            {
              id: "waiting",
              label: t("scannerQueueFilterWaiting"),
              selected: filters.includes("waiting"),
              icon: "clock",
            },
            {
              id: "confirmed",
              label: t("scannerQueueFilterConfirmed"),
              selected: filters.includes("confirmed"),
              icon: "checkmark.circle",
            },
          ]}
          onSelect={(id) => {
            if (id === "all") setFilters([]);
            else if (id === "errors" || id === "waiting" || id === "confirmed")
              setFilters((current) =>
                current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
              );
          }}
        />
      </View>

      {queue.length === 0 ? (
        <Section>
          <EmptyState
            icon={onlyErrors ? "checkmark.circle" : "arrow.triangle.2.circlepath"}
            title={onlyErrors ? t("scannerNoSyncErrors") : t("scannerNoQueue")}
            description={
              onlyErrors ? t("scannerNoSyncErrorsDescription") : t("scannerNoQueueDescription")
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
                activitiesById={activitiesById}
                canManage={canManage}
                people={people}
                peopleIndex={peopleIndex}
                scan={scan}
                onDiscard={discard}
                onRetry={sync.retryOne}
              />
            </View>
          ))}
        </Section>
      )}

      <Section title={t("scannerErrorHistoryTitle")} footer={t("scannerErrorHistoryFooter")}>
        {sync.errorHistory.length === 0 ? (
          <Text
            style={{ ...type.compact, color: colors.secondaryLabel, lineHeight: 19, padding: 16 }}
          >
            {t("scannerNoSyncErrorsDescription")}
          </Text>
        ) : (
          sync.errorHistory.map((entry, index) => (
            <View key={entry.id}>
              {index > 0 ? <Separator inset={16} /> : null}
              <ErrorHistoryRow
                activitiesById={activitiesById}
                entry={entry}
                peopleIndex={peopleIndex}
                scan={queueById.get(entry.scanId)}
              />
            </View>
          ))
        )}
      </Section>
    </ScrollView>
  );
}

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

const QueueRow = memo(function QueueRow({
  scan,
  people,
  peopleIndex,
  activities,
  activitiesById,
  canManage,
  onRetry,
  onDiscard,
}: {
  scan: PendingScan;
  /** Raw roster, only needed for `ManualLogDetails`'s own (rarer) lookups. */
  people: ScannerPerson[];
  peopleIndex: PeopleLookup;
  /** Raw activities, only needed for `ManualLogDetails`'s own (rarer) lookups. */
  activities: ScannerActivity[];
  activitiesById: Map<number, ScannerActivity>;
  canManage: boolean;
  onRetry: (id: string) => void;
  onDiscard: (id: string) => void;
}) {
  const { t } = useLocale();
  const subject = subjectLabel(scan, peopleIndex);
  const status = queueStatus(scan, t);
  return (
    <View style={{ gap: 8, padding: 16 }}>
      <View style={{ alignItems: "center", flexDirection: "row", gap: 10 }}>
        <SymbolView name={status.icon} tintColor={status.color} size={19} accessible={false} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text
            numberOfLines={1}
            style={{ ...type.subhead, color: colors.label, fontWeight: "700" }}
          >
            {subject ?? scannerOperationLabel(scan, t)}
          </Text>
          <Text
            numberOfLines={2}
            style={{ ...type.footnote, color: colors.secondaryLabel, lineHeight: 18 }}
          >
            {scannerOperationLabel(scan, t)} · {detailLabel(scan, activitiesById, t)}
          </Text>
        </View>
        <StatusPill tone={status.tone}>{status.label}</StatusPill>
      </View>
      <Text style={{ ...type.caption, color: colors.tertiaryLabel, paddingLeft: 29 }}>
        {formatDateTime(scan.createdAt, "")}
        {scan.attempts > 0
          ? ` · ${t("scannerAttemptsCount", { count: String(scan.attempts) })}`
          : ""}
      </Text>
      {scan.lastError ? (
        <Text
          accessibilityRole="alert"
          selectable
          style={{ ...type.footnote, color: colors.destructive, lineHeight: 18, paddingLeft: 29 }}
        >
          {scan.status === "failed" ? scan.lastError : t("scannerOfflineWaiting")}
        </Text>
      ) : null}
      {scan.status === "failed" || scan.lastError ? (
        <View style={{ gap: 6, marginTop: 4, paddingLeft: 29 }}>
          <Text style={{ ...type.caption, color: colors.secondaryLabel, fontWeight: "700" }}>
            {t("scannerReconciliationDetails")}
          </Text>
          <ManualLogDetails activities={activities} people={people} scan={scan} showHint={false} />
        </View>
      ) : null}
      {scan.status === "failed" && canManage ? (
        <View style={{ flexDirection: "row", gap: 8, justifyContent: "flex-end", paddingLeft: 29 }}>
          <CompactAction
            icon="arrow.clockwise"
            label={t("retry")}
            onPress={() => onRetry(scan.id)}
          />
          <CompactAction
            destructive
            icon="trash"
            label={t("scannerDiscardScan")}
            onPress={() => onDiscard(scan.id)}
          />
        </View>
      ) : null}
    </View>
  );
});

const ErrorHistoryRow = memo(function ErrorHistoryRow({
  entry,
  scan,
  peopleIndex,
  activitiesById,
}: {
  entry: ScannerSyncErrorEntry;
  scan?: PendingScan;
  peopleIndex: PeopleLookup;
  activitiesById: Map<number, ScannerActivity>;
}) {
  const { t } = useLocale();
  const context = scan
    ? `${subjectLabel(scan, peopleIndex) ?? scannerOperationLabel(scan, t)} · ${detailLabel(scan, activitiesById, t)}`
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
        <Text style={{ ...type.compact, color: colors.label, flex: 1, fontWeight: "700" }}>
          {t(entry.type === "rejected" ? "scannerErrorRejected" : "scannerErrorRetryable")}
        </Text>
        <Text style={{ ...type.caption, color: colors.tertiaryLabel }}>
          {formatDateTime(entry.occurredAt, "")}
        </Text>
      </View>
      <Text
        selectable
        style={{ ...type.footnote, color: colors.secondaryLabel, lineHeight: 18, paddingLeft: 25 }}
      >
        {scanFailureText(entry.message, t)}
      </Text>
      {context ? (
        <Text
          style={{ ...type.caption, color: colors.tertiaryLabel, lineHeight: 17, paddingLeft: 25 }}
        >
          {context}
        </Text>
      ) : null}
      <Text style={{ ...type.caption, color: colors.tertiaryLabel, paddingLeft: 25 }}>
        {t("scannerErrorScanId", { id: entry.scanId })}
      </Text>
    </View>
  );
});

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
    <PressableFeedback
      feedback="opacity"
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={() => {
        void haptic("light");
        onPress();
      }}
      style={{
        alignItems: "center",
        borderColor: destructive ? colors.destructive : colors.separator,
        borderCurve: "continuous",
        borderRadius: radius.chip,
        borderWidth: 1,
        flexDirection: "row",
        gap: 5,
        minHeight: 40,
        paddingHorizontal: 12,
      }}
    >
      <SymbolView
        name={icon}
        tintColor={destructive ? colors.destructive : colors.accent}
        size={14}
        accessible={false}
      />
      <Text
        style={{
          ...type.footnote,
          color: destructive ? colors.destructive : colors.accent,

          fontWeight: "600",
        }}
      >
        {label}
      </Text>
    </PressableFeedback>
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
