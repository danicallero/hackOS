import { useRouter } from "expo-router";
import { type ReactNode, useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import Swipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import Animated, { type SharedValue, useAnimatedStyle } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ActionButton, FloatingGlassButton, Section } from "@/components/native-ui";
import { SymbolView, type SymbolViewProps } from "@/components/symbol";
import { CLOCK_SKEW_TOLERANCE_MS } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { listScannerActivities, listScannerPeople } from "@/lib/scanner-db";
import { scannerQueueHealth, scannerTransactionState } from "@/lib/scanner-state";
import type { PendingScan, ScannerActivity, ScannerPerson } from "@/lib/scanner-types";
import { colors } from "@/theme/colors";

function ClockSkewBanner() {
  const { t } = useLocale();
  return (
    <View
      accessibilityRole="alert"
      style={{
        alignItems: "flex-start",
        backgroundColor: colors.warningSurface,
        borderCurve: "continuous",
        borderRadius: 14,
        flexDirection: "row",
        gap: 10,
        padding: 13,
      }}
    >
      <SymbolView
        name="clock.badge.exclamationmark.fill"
        tintColor={colors.warning}
        size={20}
        accessible={false}
      />
      <View style={{ flex: 1, gap: 3 }}>
        <Text selectable style={{ color: colors.warning, fontSize: 15, fontWeight: "700" }}>
          {t("clockSkewTitle")}
        </Text>
        <Text selectable style={{ color: colors.warning, fontSize: 13, lineHeight: 18 }}>
          {t("clockSkewBody")}
        </Text>
      </View>
    </View>
  );
}

function findSubject(scan: PendingScan, people: ScannerPerson[]): ScannerPerson | undefined {
  const p = scan.payload;
  switch (p.kind) {
    case "accreditation":
      return people.find((person) => person.ticketToken === p.ticketToken);
    case "accreditation_user":
    case "badge_rotation":
    case "badge_removal":
      return people.find((person) => person.userId === p.userId);
    case "presence":
    case "activity":
      return people.find(
        (person) => person.badgeId === p.badgeId || person.revokedBadgeIds.includes(p.badgeId),
      );
  }
}

function subjectLabel(scan: PendingScan, people: ScannerPerson[]): string | null {
  const person = findSubject(scan, people);
  if (!person) return null;
  return [person.name, person.surname].filter(Boolean).join(" ") || person.email;
}

function detailLabel(
  scan: PendingScan,
  activities: ScannerActivity[],
  t: ReturnType<typeof useLocale>["t"],
): string {
  const p = scan.payload;
  switch (p.kind) {
    case "accreditation":
    case "accreditation_user":
      return `${p.badgeId} · ${p.method}`;
    case "badge_rotation":
      return `${p.currentBadgeId} → ${p.newBadgeId}`;
    case "badge_removal":
      return p.reason;
    case "presence":
      return `${p.badgeId} · ${p.direction === "in" ? t("presenceSignalEntry") : t("presenceSignalExit")}`;
    case "activity": {
      const activity = activities.find((a) => a.id === p.activityId);
      return `${p.badgeId} · ${activity?.name ?? `#${p.activityId}`}`;
    }
  }
}

/**
 * Everything an operator needs to manually replicate a permanently rejected
 * scan in the web admin panel before discarding it from the device queue —
 * the queue's local `scannerPeople`/`activities` cache can resolve a badge
 * ID or user ID to the person's name/email even if the admin lookup can't.
 */
function manualLogDetails(
  scan: PendingScan,
  people: ScannerPerson[],
  activities: ScannerActivity[],
  t: ReturnType<typeof useLocale>["t"],
): Array<{ label: string; value: string }> {
  const p = scan.payload;
  const subject = findSubject(scan, people);
  const details: Array<{ label: string; value: string }> = [];
  if (subject) {
    details.push({
      label: t("scannerFieldPerson"),
      value: `${[subject.name, subject.surname].filter(Boolean).join(" ") || subject.email} (${subject.email})`,
    });
    details.push({ label: t("scannerFieldUserId"), value: String(subject.userId) });
  } else if ("userId" in p) {
    details.push({ label: t("scannerFieldUserId"), value: String(p.userId) });
  } else {
    details.push({ label: t("scannerFieldPerson"), value: t("scannerFieldUnknownPerson") });
  }
  switch (p.kind) {
    case "accreditation":
      details.push({ label: t("scannerFieldTicket"), value: p.ticketToken });
      details.push({ label: t("scannerFieldBadge"), value: p.badgeId });
      details.push({ label: t("scannerFieldMethod"), value: p.method });
      break;
    case "accreditation_user":
      details.push({ label: t("scannerFieldBadge"), value: p.badgeId });
      details.push({ label: t("scannerFieldMethod"), value: p.method });
      break;
    case "badge_rotation":
      details.push({ label: t("scannerFieldCurrentBadge"), value: p.currentBadgeId });
      details.push({ label: t("scannerFieldNewBadge"), value: p.newBadgeId });
      details.push({ label: t("scannerFieldReason"), value: p.reason });
      break;
    case "badge_removal":
      details.push({ label: t("scannerFieldCurrentBadge"), value: p.currentBadgeId });
      details.push({ label: t("scannerFieldReason"), value: p.reason });
      break;
    case "presence":
      details.push({ label: t("scannerFieldBadge"), value: p.badgeId });
      details.push({
        label: t("scannerFieldDirection"),
        value: p.direction === "in" ? t("presenceSignalEntry") : t("presenceSignalExit"),
      });
      details.push({
        label: t("scannerFieldTimestamp"),
        value: new Date(p.scannedAt).toLocaleString(),
      });
      break;
    case "activity": {
      const activity = activities.find((a) => a.id === p.activityId);
      details.push({ label: t("scannerFieldBadge"), value: p.badgeId });
      details.push({
        label: t("scannerFieldActivity"),
        value: activity ? `${activity.name} (#${p.activityId})` : `#${p.activityId}`,
      });
      details.push({
        label: t("scannerFieldAllowRepeat"),
        value: p.allowRepeat ? t("scannerYes") : t("scannerNo"),
      });
      details.push({
        label: t("scannerFieldTimestamp"),
        value: new Date(p.scannedAt).toLocaleString(),
      });
      break;
    }
  }
  return details;
}

function ManualLogDetails({
  scan,
  people,
  activities,
}: {
  scan: PendingScan;
  people: ScannerPerson[];
  activities: ScannerActivity[];
}) {
  const { t } = useLocale();
  const details = manualLogDetails(scan, people, activities, t);
  return (
    <View
      style={{
        borderLeftColor: colors.destructive,
        borderLeftWidth: 2,
        gap: 8,
        paddingLeft: 10,
      }}
    >
      <Text style={{ color: colors.secondaryLabel, fontSize: 12, lineHeight: 16 }}>
        {t("scannerManualLogHint")}
      </Text>
      <View style={{ gap: 4 }}>
        {details.map((detail) => (
          <View key={detail.label} style={{ flexDirection: "row", gap: 8 }}>
            <Text style={{ color: colors.secondaryLabel, fontSize: 13, width: 96 }}>
              {detail.label}
            </Text>
            <Text selectable style={{ color: colors.label, flex: 1, fontSize: 13 }}>
              {detail.value}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/**
 * The action panel revealed by swiping a failed scan's row left, matching
 * the OS notification center's swipe-to-clear gesture: swiping only reveals
 * the button, and the scan is discarded on the deliberate follow-up tap —
 * never by the swipe distance alone, so a stray swipe can't delete data.
 */
function DeleteRevealAction({
  progress,
  onDelete,
}: {
  progress: SharedValue<number>;
  onDelete: () => void;
}) {
  const { t } = useLocale();
  const style = useAnimatedStyle(() => ({ opacity: progress.value }));
  return (
    <Animated.View style={[{ justifyContent: "center", marginLeft: 8 }, style]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("scannerDeleteScan")}
        onPress={onDelete}
        style={({ pressed }) => ({
          alignItems: "center",
          backgroundColor: colors.destructive,
          borderCurve: "continuous",
          borderRadius: 14,
          flexDirection: "row",
          gap: 6,
          height: "100%",
          justifyContent: "center",
          opacity: pressed ? 0.75 : 1,
          paddingHorizontal: 18,
        })}
      >
        <SymbolView name="trash.fill" tintColor="white" size={16} accessible={false} />
        <Text style={{ color: "white", fontSize: 14, fontWeight: "700" }}>
          {t("scannerDeleteScan")}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

/** Wraps a failed scan's row in the swipe-to-reveal-delete gesture; other statuses render inert. */
function SwipeableQueueRow({
  deletable,
  onDelete,
  children,
}: {
  deletable: boolean;
  onDelete: () => void;
  children: ReactNode;
}) {
  if (!deletable) return <>{children}</>;
  return (
    <Swipeable
      renderRightActions={(progress) => (
        <DeleteRevealAction progress={progress} onDelete={onDelete} />
      )}
      rightThreshold={40}
    >
      {children}
    </Swipeable>
  );
}

export function ScannerTransactionStatus({
  scan,
  bare = false,
}: {
  scan?: PendingScan | null;
  /** Renders as a plain icon+text row with no card chrome, for use inside a row that's already card-framed (e.g. the device queue list). */
  bare?: boolean;
}) {
  const { t } = useLocale();
  const state = scannerTransactionState(scan);
  const presentation = {
    ready: { icon: "qrcode.viewfinder", label: t("scannerStateReady"), tone: colors.accent },
    saved: {
      icon: "internaldrive.fill",
      label: t("scannerStateSaved"),
      tone: colors.warning,
    },
    confirmed: {
      icon: "checkmark.circle.fill",
      label: t("scannerStateConfirmed"),
      tone: colors.success,
    },
    attention: {
      icon: "exclamationmark.triangle.fill",
      label: t("scannerStateAttention"),
      tone: colors.destructive,
    },
  }[state];
  return (
    <View
      accessibilityLiveRegion={state === "attention" ? "assertive" : "polite"}
      accessibilityRole="summary"
      style={
        bare
          ? { alignItems: "center", flexDirection: "row", gap: 8 }
          : {
              alignItems: "center",
              backgroundColor: colors.surface,
              borderCurve: "continuous",
              borderRadius: 14,
              flexDirection: "row",
              gap: 10,
              minHeight: 50,
              paddingHorizontal: 14,
            }
      }
    >
      <SymbolView
        accessible={false}
        name={presentation.icon as SymbolViewProps["name"]}
        size={bare ? 15 : 19}
        tintColor={presentation.tone}
      />
      <View style={{ flex: 1, gap: 2, paddingVertical: bare ? 0 : 10 }}>
        <Text
          style={{
            color: colors.label,
            fontSize: bare ? 13 : 15,
            fontWeight: "700",
            paddingTop: state === "attention" ? 10 : 0,
          }}
        >
          {presentation.label}
        </Text>
        {scan?.lastError ? (
          <Text
            selectable
            style={{
              color: colors.secondaryLabel,
              fontSize: 13,
              paddingBottom: state === "attention" ? 10 : 0,
            }}
          >
            {scan.status === "failed" ? t("scannerBusinessRejected") : t("scannerOfflineWaiting")}
            {": "}
            {scan.lastError}
          </Text>
        ) : state === "saved" ? (
          <Text style={{ color: colors.secondaryLabel, fontSize: 13 }}>
            {t("scannerAwaitingAcknowledgement")}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export function ScannerQueueStatus({
  queue,
  syncing,
  onSync,
  onRetry,
  onDelete,
  clockSkewMs = null,
}: {
  queue: PendingScan[];
  syncing: boolean;
  clockSkewMs?: number | null;
  onSync: () => void;
  onRetry: () => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [people, setPeople] = useState<ScannerPerson[]>([]);
  const [activities, setActivities] = useState<ScannerActivity[]>([]);
  const health = scannerQueueHealth(queue);

  useEffect(() => {
    if (!open) return;
    void listScannerPeople().then(setPeople);
    void listScannerActivities().then(setActivities);
  }, [open]);
  const hasAttention = health.attention > 0;
  const label = hasAttention
    ? t("scannerQueueAttentionCount", { count: String(health.attention) })
    : health.saved > 0
      ? t("scannerQueueSavedCount", { count: String(health.saved) })
      : t("scannerStateReady");
  const operationLabel = (scan: PendingScan) =>
    scan.kind === "activity"
      ? t("scannerActivity")
      : scan.kind === "presence"
        ? t("scannerPresence")
        : scan.kind === "accreditation" || scan.kind === "accreditation_user"
          ? t("scannerAccreditation")
          : t("scannerBadge");
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={() => setOpen(true)}
        style={({ pressed }) => ({
          alignItems: "center",
          alignSelf: "center",
          backgroundColor: "rgba(0,0,0,0.72)",
          borderCurve: "continuous",
          borderRadius: 999,
          flexDirection: "row",
          gap: 8,
          minHeight: 44,
          opacity: pressed ? 0.65 : 1,
          paddingHorizontal: 14,
        })}
      >
        <SymbolView
          accessible={false}
          name={hasAttention ? "exclamationmark.triangle.fill" : "arrow.triangle.2.circlepath"}
          size={16}
          tintColor={
            hasAttention ? colors.destructive : health.saved > 0 ? colors.warning : "white"
          }
        />
        <Text style={{ color: "white", fontSize: 14, fontWeight: "700" }}>{label}</Text>
      </Pressable>
      <Modal
        animationType="slide"
        onRequestClose={() => setOpen(false)}
        presentationStyle="pageSheet"
        visible={open}
      >
        <View style={{ backgroundColor: colors.background, flex: 1 }}>
          <ScrollView
            contentInsetAdjustmentBehavior="automatic"
            contentContainerStyle={{
              gap: 22,
              padding: 16,
              paddingBottom: Math.max(32, insets.bottom + 16),
              paddingTop: 16,
            }}
          >
            <View style={{ justifyContent: "center", minHeight: 44, paddingHorizontal: 52 }}>
              <Text
                selectable
                style={{
                  color: colors.label,
                  fontSize: 20,
                  fontWeight: "700",
                  textAlign: "center",
                }}
              >
                {t("scannerQueue")}
              </Text>
              <Text
                style={{
                  color: colors.secondaryLabel,
                  fontSize: 14,
                  paddingTop: 4,
                  textAlign: "center",
                }}
              >
                {health.offline > 0
                  ? t("scannerOfflineCount", { count: String(health.offline) })
                  : label}
              </Text>
            </View>

            {clockSkewMs !== null && Math.abs(clockSkewMs) > CLOCK_SKEW_TOLERANCE_MS ? (
              <ClockSkewBanner />
            ) : null}

            <Text
              selectable
              style={{
                color: colors.secondaryLabel,
                fontSize: 13,
                fontWeight: "600",
                paddingHorizontal: 16,
              }}
            >
              {t("scannerQueue")}
            </Text>

            {queue.length === 0 ? (
              <ScannerTransactionStatus />
            ) : (
              <View style={{ gap: 10 }}>
                {queue
                  .slice(-20)
                  .reverse()
                  .map((scan) => {
                    const subject = subjectLabel(scan, people);
                    const deletable = scan.status === "failed";
                    return (
                      <SwipeableQueueRow
                        key={scan.id}
                        deletable={deletable}
                        onDelete={() => onDelete(scan.id)}
                      >
                        <View
                          style={{
                            backgroundColor: colors.surface,
                            borderCurve: "continuous",
                            borderRadius: 14,
                            gap: 3,
                            padding: 13,
                          }}
                        >
                          <View style={{ alignItems: "baseline", flexDirection: "row", gap: 8 }}>
                            <Text
                              numberOfLines={1}
                              style={{
                                color: colors.label,
                                flex: 1,
                                fontSize: 14,
                                fontWeight: "700",
                              }}
                            >
                              {subject ?? operationLabel(scan)}
                            </Text>
                            <Text style={{ color: colors.secondaryLabel, fontSize: 12 }}>
                              {new Date(scan.createdAt).toLocaleTimeString()}
                            </Text>
                          </View>
                          <Text style={{ color: colors.secondaryLabel, fontSize: 13 }}>
                            {operationLabel(scan)} · {detailLabel(scan, activities, t)}
                            {scan.attempts > 1
                              ? ` · ${t("scannerAttemptsCount", { count: String(scan.attempts) })}`
                              : ""}
                          </Text>
                          <ScannerTransactionStatus scan={scan} bare />
                          {deletable ? (
                            <ManualLogDetails scan={scan} people={people} activities={activities} />
                          ) : null}
                        </View>
                      </SwipeableQueueRow>
                    );
                  })}
              </View>
            )}

            <Section>
              <ActionButton
                label={t("scannerSeeHistory")}
                icon="clock.arrow.circlepath"
                onPress={() => {
                  setOpen(false);
                  router.push("/(tabs)/scan/scan-log");
                }}
              />
            </Section>
          </ScrollView>

          <FloatingGlassButton
            top={16}
            side="left"
            icon="xmark"
            accessibilityLabel={t("close")}
            onPress={() => setOpen(false)}
          />
          <FloatingGlassButton
            top={16}
            side="right"
            icon={hasAttention ? "exclamationmark.arrow.circlepath" : "arrow.triangle.2.circlepath"}
            tintColor={hasAttention ? colors.destructive : colors.accent}
            accessibilityLabel={hasAttention ? t("scannerRetryFailed") : t("scannerSync")}
            accessibilityState={{ busy: syncing }}
            disabled={syncing}
            onPress={hasAttention ? onRetry : onSync}
          />
        </View>
      </Modal>
    </>
  );
}
