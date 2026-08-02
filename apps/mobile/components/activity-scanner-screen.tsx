import { Host as NativeHost } from "@expo/ui";
import { Button as SwiftButton, Text as SwiftText } from "@expo/ui/swift-ui";
import {
  buttonBorderShape,
  buttonStyle,
  disabled as disabledModifier,
  frame,
  multilineTextAlignment,
} from "@expo/ui/swift-ui/modifiers";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GlassView } from "@/components/glass-view";
import { AdaptiveBackButton, AdaptiveToolbarButton } from "@/components/native-ui";
import { QrCamera } from "@/components/QrCamera";
import { ScannerQueueStatus } from "@/components/scanner-transaction-status";
import { SymbolView } from "@/components/symbol";
import { apiFetch } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { subscribeToManualActivityScan } from "@/lib/manual-activity-scan";
import { useMeContext } from "@/lib/me-context";
import {
  enqueueLocalScan,
  findPersonByBadge,
  getActivityState,
  listScannerActivities,
  pendingScans,
} from "@/lib/scanner-db";
import type { ScannerActivity, ScannerPerson } from "@/lib/scanner-types";
import { useScannerSync } from "@/lib/use-scanner";
import { colors } from "@/theme/colors";

interface ActivityScanResult {
  badgeId: string;
  count: number;
  person: ScannerPerson;
  state: "saved" | "confirmed" | "attention" | "repeat_pending";
  error?: string;
  wasRepeat: boolean;
}

export function ActivityScannerScreen() {
  const { id, manualBadge, manualNonce } = useLocalSearchParams<{
    id: string;
    manualBadge?: string;
    manualNonce?: string;
  }>();
  const activityId = Number(id);
  const router = useRouter();
  const { language, t } = useLocale();
  const insets = useSafeAreaInsets();
  const { me } = useMeContext();
  const ownerUserId = me?.id;
  const syncState = useScannerSync();
  const { sync: runSync, lastSync } = syncState;
  const [activity, setActivity] = useState<ScannerActivity | null>(null);
  const [result, setResult] = useState<ActivityScanResult | null>(null);
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<ActivityStats | null>(null);
  const handledManualScan = useRef<string | null>(null);

  const loadStats = useCallback(async () => {
    try {
      const response = await apiFetch<{ items: ActivityStats[] }>("/api/activities/scannable");
      setStats(response.items.find((item) => item.activityId === activityId) ?? null);
    } catch {
      // The scanner and its offline queue remain usable without live statistics.
    }
  }, [activityId]);

  useEffect(() => {
    void listScannerActivities().then((items) =>
      setActivity(items.find((item) => item.id === activityId) ?? null),
    );
  }, [activityId]);

  useEffect(() => {
    void loadStats();
    const interval = setInterval(() => void loadStats(), 10_000);
    return () => clearInterval(interval);
  }, [loadStats]);
  useEffect(() => {
    if (lastSync) void loadStats();
  }, [lastSync, loadStats]);

  const store = useCallback(
    async (person: ScannerPerson, badgeId: string, allowRepeat: boolean, count: number) => {
      if (ownerUserId === undefined) return;
      setRegistering(true);
      setError(null);
      try {
        const scanId = await enqueueLocalScan(
          {
            kind: "activity",
            activityId,
            badgeId,
            allowRepeat,
            scannedAt: new Date().toISOString(),
          },
          ownerUserId,
        );
        setResult({
          badgeId,
          count: count + 1,
          person,
          state: "saved",
          wasRepeat: allowRepeat,
        });
        await runSync();
        // A business rejection fails the queued scan permanently — surface it
        // here instead of leaving the operator believing it was registered.
        const stored = (await pendingScans(ownerUserId)).find((scan) => scan.id === scanId);
        if (stored?.status === "failed") {
          setResult((current) =>
            current
              ? {
                  ...current,
                  error: stored.lastError ?? t("presenceScanRejectedBody"),
                  state: "attention",
                }
              : current,
          );
        } else if (stored?.status === "acknowledged") {
          setResult((current) => (current ? { ...current, state: "confirmed" } : current));
        }
        await loadStats();
      } finally {
        setRegistering(false);
      }
    },
    [activityId, loadStats, ownerUserId, runSync, t],
  );

  const scanned = useCallback(
    async (raw: string) => {
      const badgeId = raw.trim();
      const found = await findPersonByBadge(badgeId);
      if (!found.person) {
        setError(found.revoked ? t("scannerBadgeRevoked") : t("scannerBadgeUnknown"));
        setResult(null);
        return;
      }
      const state = await getActivityState(found.person.userId, activityId);
      setError(null);
      // Any repeat — meal or registrable activity — needs explicit staff
      // confirmation (H25/H26): the API 409s repeats sent without allowRepeat,
      // which would strand the queued scan as failed.
      if (state.count > 0) {
        setResult({
          badgeId,
          count: state.count,
          person: found.person,
          state: "repeat_pending",
          wasRepeat: true,
        });
        return;
      }
      await store(found.person, badgeId, false, state.count);
    },
    [activityId, store, t],
  );

  useEffect(() => {
    if (!activity || !manualBadge || !manualNonce || handledManualScan.current === manualNonce)
      return;
    handledManualScan.current = manualNonce;
    void scanned(manualBadge);
  }, [activity, manualBadge, manualNonce, scanned]);

  useEffect(
    () => subscribeToManualActivityScan(activityId, (badgeId) => void scanned(badgeId)),
    [activityId, scanned],
  );

  return (
    <View style={{ backgroundColor: "black", flex: 1 }}>
      <QrCamera
        hint={null}
        onValue={(value) => void scanned(value)}
        scanningEnabled={Boolean(activity) && !result}
      />
      <AdaptiveBackButton top={insets.top + 12} onPress={() => router.back()} />
      <AdaptiveToolbarButton
        top={insets.top + 12}
        side="right"
        icon="person.crop.badge.magnifyingglass"
        tintColor="white"
        accessibilityLabel={t("scannerSearchPerson")}
        onPress={() =>
          router.push({
            pathname: "/(tabs)/activities/people",
            params: { activityId: String(activityId) },
          })
        }
      />
      <View
        pointerEvents="box-none"
        style={{ left: 0, position: "absolute", right: 0, top: insets.top + 12 }}
      >
        <GlassView
          colorScheme="dark"
          glassEffectStyle="regular"
          style={{
            alignSelf: "center",
            borderRadius: 999,
            height: 44,
            justifyContent: "center",
            maxWidth: "55%",
            paddingHorizontal: 16,
          }}
        >
          <Text
            selectable
            numberOfLines={1}
            style={{ color: "white", fontSize: 16, fontWeight: "700", textAlign: "center" }}
          >
            {activity?.name ?? t("scannerActivity")}
          </Text>
        </GlassView>
        <ActivityStatistics activity={activity} stats={stats} />
      </View>
      <View
        pointerEvents="box-none"
        style={{ left: 16, position: "absolute", right: 16, top: insets.top + 150 }}
      >
        <ScannerQueueStatus
          queue={syncState.queue}
          syncing={syncState.syncing}
          onSync={() => void syncState.sync()}
          onRetry={() => void syncState.retryFailed()}
          onDelete={(id) => void syncState.discardScan(id)}
          clockSkewMs={syncState.clockSkewMs}
        />
      </View>
      {error ? (
        <GlassView
          colorScheme="dark"
          glassEffectStyle="regular"
          style={{
            borderRadius: 18,
            bottom: insets.bottom + 26,
            left: 16,
            minHeight: 60,
            overflow: "hidden",
            position: "absolute",
            right: 94,
          }}
        >
          <Pressable
            accessibilityLabel={t("close")}
            accessibilityRole="button"
            accessibilityLiveRegion="assertive"
            onPress={() => setError(null)}
            style={{ alignItems: "center", flex: 1, flexDirection: "row", gap: 9, padding: 14 }}
          >
            <SymbolView name="xmark.circle.fill" tintColor={colors.destructive} size={20} />
            <Text selectable style={{ color: "white", flex: 1, fontSize: 15, fontWeight: "700" }}>
              {error}
            </Text>
          </Pressable>
        </GlassView>
      ) : null}
      {result ? (
        <ActivityResultPanel
          activity={activity}
          language={language}
          registering={registering}
          result={result}
          onCancel={() => setResult(null)}
          onContinue={() => setResult(null)}
          onRegisterAnother={() => void store(result.person, result.badgeId, true, result.count)}
        />
      ) : null}
    </View>
  );
}

function ActivityResultPanel({
  activity,
  language,
  registering,
  result,
  onCancel,
  onContinue,
  onRegisterAnother,
}: {
  activity: ScannerActivity | null;
  language: "en" | "es" | "gl";
  registering: boolean;
  result: ActivityScanResult;
  onCancel: () => void;
  onContinue: () => void;
  onRegisterAnother: () => void;
}) {
  const { t } = useLocale();
  const [actionsRowWidth, setActionsRowWidth] = useState(0);
  const meal = activity?.category === "meal";
  const repeatPending = result.state === "repeat_pending";
  const fullName =
    [result.person.name, result.person.surname].filter(Boolean).join(" ") || result.person.email;
  const hasMealDetails =
    meal &&
    (result.person.intolerances.length > 0 ||
      result.person.foodIntoleranceNotes ||
      result.person.notes);

  return (
    <View
      accessibilityViewIsModal
      style={{
        alignItems: "center",
        bottom: 0,
        justifyContent: "center",
        left: 0,
        padding: 20,
        position: "absolute",
        right: 0,
        top: 0,
      }}
    >
      <GlassView
        colorScheme="dark"
        glassEffectStyle="regular"
        style={{
          borderCurve: "continuous",
          borderRadius: 28,
          maxWidth: 390,
          overflow: "hidden",
          width: "100%",
        }}
      >
        <View style={{ gap: 18, padding: 20 }}>
          <View style={{ alignItems: "flex-start", flexDirection: "row", gap: 16 }}>
            <View style={{ flex: 1, gap: 5 }}>
              <View style={{ alignItems: "center", flexDirection: "row", gap: 7 }}>
                <SymbolView
                  name={
                    repeatPending
                      ? "clock.badge.exclamationmark"
                      : result.state === "confirmed"
                        ? "checkmark.circle.fill"
                        : result.state === "attention"
                          ? "exclamationmark.triangle.fill"
                          : "internaldrive.fill"
                  }
                  tintColor={
                    repeatPending || result.state === "saved"
                      ? colors.warning
                      : result.state === "attention"
                        ? colors.destructive
                        : colors.success
                  }
                  size={18}
                />
                <Text
                  selectable
                  style={{
                    color:
                      repeatPending || result.state === "saved"
                        ? colors.warning
                        : result.state === "attention"
                          ? colors.destructive
                          : colors.success,
                    fontSize: 13,
                    fontWeight: "700",
                  }}
                >
                  {repeatPending
                    ? t("scannerRepeatFound")
                    : result.state === "confirmed"
                      ? t("scannerStateConfirmed")
                      : result.state === "attention"
                        ? t("scannerStateAttention")
                        : t("scannerStateSaved")}
                </Text>
              </View>
              <Text selectable style={{ color: "white", fontSize: 23, fontWeight: "700" }}>
                {fullName}
              </Text>
              <Text selectable style={{ color: "rgba(255,255,255,0.68)", fontSize: 15 }}>
                {result.person.email || t("accountNotSet")}
              </Text>
            </View>
            <View
              style={{
                alignItems: "center",
                backgroundColor: repeatPending ? "rgba(255,149,0,0.18)" : "rgba(52,199,89,0.18)",
                borderRadius: 18,
                height: 64,
                justifyContent: "center",
                width: 64,
              }}
            >
              <Text
                selectable
                style={{
                  color: repeatPending ? colors.warning : colors.success,
                  fontSize: 32,
                  fontVariant: ["tabular-nums"],
                  fontWeight: "800",
                }}
              >
                {result.count}
              </Text>
            </View>
          </View>

          {hasMealDetails ? (
            <View
              style={{
                backgroundColor: "rgba(255,255,255,0.09)",
                borderCurve: "continuous",
                borderRadius: 16,
                gap: 12,
                padding: 14,
              }}
            >
              <Text selectable style={{ color: "rgba(255,255,255,0.62)", fontWeight: "700" }}>
                {t("scannerDietaryGroup")}
              </Text>
              {result.person.intolerances.length > 0 ? (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 7 }}>
                  {result.person.intolerances.map((item) => (
                    <View
                      key={item.id}
                      style={{
                        backgroundColor: "rgba(255,149,0,0.18)",
                        borderRadius: 999,
                        paddingHorizontal: 10,
                        paddingVertical: 6,
                      }}
                    >
                      <Text selectable style={{ color: colors.warning, fontWeight: "700" }}>
                        {item.label[language] ?? item.label.en}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}
              {result.person.foodIntoleranceNotes ? (
                <View style={{ gap: 3 }}>
                  <Text
                    selectable
                    style={{ color: colors.warning, fontSize: 12, fontWeight: "700" }}
                  >
                    {t("personFoodNotes")}
                  </Text>
                  <Text selectable style={{ color: "white", lineHeight: 20 }}>
                    {result.person.foodIntoleranceNotes}
                  </Text>
                </View>
              ) : null}
              {result.person.notes ? (
                <View style={{ gap: 3 }}>
                  <Text
                    selectable
                    style={{ color: "rgba(255,255,255,0.62)", fontSize: 12, fontWeight: "700" }}
                  >
                    {t("personNotes")}
                  </Text>
                  <Text selectable style={{ color: "white", lineHeight: 20 }}>
                    {result.person.notes}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}

          {result.error ? (
            <Text
              accessibilityLiveRegion="assertive"
              selectable
              style={{ color: colors.destructive, fontSize: 14, fontWeight: "700" }}
            >
              {t("scannerBusinessRejected")}: {result.error}
            </Text>
          ) : null}

          {repeatPending ? (
            <View
              onLayout={(event) => setActionsRowWidth(event.nativeEvent.layout.width)}
              style={{ flexDirection: "row", gap: 10 }}
            >
              {actionsRowWidth > 0
                ? (() => {
                    const halfWidth = (actionsRowWidth - 10) / 2;
                    const cancelWidth = halfWidth + 2;
                    const cancelHeight = 50;
                    const registerWidth = halfWidth;
                    const registerHeight = 48;
                    return (
                      <>
                        <NativeHost
                          colorScheme="dark"
                          style={{ height: cancelHeight, width: cancelWidth }}
                        >
                          <SwiftButton
                            modifiers={[
                              disabledModifier(registering),
                              buttonStyle("bordered"),
                              buttonBorderShape("capsule"),
                              frame({ height: cancelHeight, width: cancelWidth }),
                            ]}
                            onPress={onCancel}
                          >
                            <SwiftText
                              modifiers={[
                                frame({ maxWidth: Infinity, alignment: "center" }),
                                multilineTextAlignment("center"),
                              ]}
                            >
                              {t("cancel")}
                            </SwiftText>
                          </SwiftButton>
                        </NativeHost>
                        <NativeHost
                          colorScheme="dark"
                          seedColor={colors.accent}
                          style={{ height: registerHeight, width: registerWidth }}
                        >
                          <SwiftButton
                            modifiers={[
                              disabledModifier(registering),
                              buttonStyle("borderedProminent"),
                              buttonBorderShape("capsule"),
                              frame({ height: registerHeight, width: registerWidth }),
                            ]}
                            onPress={onRegisterAnother}
                          >
                            <SwiftText
                              modifiers={[
                                frame({ maxWidth: Infinity, alignment: "center" }),
                                multilineTextAlignment("center"),
                              ]}
                            >
                              {t("scannerRegisterAnother")}
                            </SwiftText>
                          </SwiftButton>
                        </NativeHost>
                      </>
                    );
                  })()
                : null}
            </View>
          ) : (
            <NativeHost colorScheme="dark" seedColor={colors.accent} style={{ height: 48 }}>
              <SwiftButton
                modifiers={[
                  buttonStyle("borderedProminent"),
                  buttonBorderShape("capsule"),
                  frame({ height: 48 }),
                ]}
                onPress={onContinue}
              >
                <SwiftText
                  modifiers={[
                    frame({ maxWidth: Infinity, alignment: "center" }),
                    multilineTextAlignment("center"),
                  ]}
                >
                  {result.wasRepeat ? t("close") : t("continue")}
                </SwiftText>
              </SwiftButton>
            </NativeHost>
          )}
        </View>
      </GlassView>
    </View>
  );
}

interface ActivityStats {
  activityId: number;
  count: number;
  distinctPeople: number;
  repeats: number;
}

function ActivityStatistics({
  activity,
  stats,
}: {
  activity: ScannerActivity | null;
  stats: ActivityStats | null;
}) {
  const { t } = useLocale();
  const meal = activity?.category === "meal";
  const items = [
    {
      icon: meal ? "fork.knife" : "qrcode",
      label: meal ? t("scannerServed") : t("scannerPasses"),
      value: stats?.count,
    },
    { icon: "person.2.fill", label: t("scannerPeople"), value: stats?.distinctPeople },
    {
      icon: "arrow.trianglehead.2.clockwise.rotate.90",
      label: t("scannerRepeats"),
      value: stats?.repeats,
    },
  ] as const;

  return (
    <View
      pointerEvents="none"
      style={{ flexDirection: "row", gap: 8, marginTop: 10, paddingHorizontal: 16 }}
    >
      {items.map((item) => (
        <GlassView
          colorScheme="dark"
          glassEffectStyle="regular"
          key={item.label}
          style={{
            borderCurve: "continuous",
            borderRadius: 16,
            flex: 1,
            gap: 5,
            padding: 12,
          }}
        >
          <View style={{ alignItems: "center", flexDirection: "row", gap: 6 }}>
            <SymbolView name={item.icon} tintColor="white" size={14} />
            <Text
              selectable
              numberOfLines={1}
              style={{ color: "rgba(255,255,255,0.72)", flex: 1, fontSize: 11, fontWeight: "600" }}
            >
              {item.label}
            </Text>
          </View>
          <Text
            selectable
            style={{
              color: "white",
              fontSize: 24,
              fontVariant: ["tabular-nums"],
              fontWeight: "700",
            }}
          >
            {item.value ?? "…"}
          </Text>
        </GlassView>
      ))}
    </View>
  );
}
