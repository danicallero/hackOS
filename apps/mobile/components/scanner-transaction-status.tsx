import { useRouter } from "expo-router";
import { type ReactNode, useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import Swipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import Animated, { type SharedValue, useAnimatedStyle } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GlassView } from "@/components/glass-view";
import { ActionButton, FloatingGlassButton, Section } from "@/components/native-ui";
import { SymbolView, type SymbolViewProps } from "@/components/symbol";
import { CLOCK_SKEW_TOLERANCE_MS } from "@/lib/api";
import { haptic } from "@/lib/haptics";
import { useLocale } from "@/lib/i18n";
import { SCAN_LOG_ROUTES } from "@/lib/scan-log-navigation";
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
        tintColor={colors.onWarningSurface}
        size={20}
        accessible={false}
      />
      <View style={{ flex: 1, gap: 3 }}>
        <Text
          selectable
          style={{ color: colors.onWarningSurface, fontSize: 15, fontWeight: "700" }}
        >
          {t("clockSkewTitle")}
        </Text>
        <Text selectable style={{ color: colors.onWarningSurface, fontSize: 13, lineHeight: 18 }}>
          {t("clockSkewBody")}
        </Text>
      </View>
    </View>
  );
}

export function findSubject(scan: PendingScan, people: ScannerPerson[]): ScannerPerson | undefined {
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
    case "presence_signal":
    case "presence_signal_activity":
      return people.find((person) => person.userId === p.userId);
    case "presence_signal_edit_door":
    case "presence_signal_edit_activity":
      return undefined;
    case "presence_signal_delete": {
      const byUserId =
        p.userId === undefined ? undefined : people.find((person) => person.userId === p.userId);
      if (byUserId) return byUserId;
      const badgeId = p.badgeId;
      if (!badgeId) return undefined;
      return people.find(
        (person) => person.badgeId === badgeId || person.revokedBadgeIds.includes(badgeId),
      );
    }
  }
}

export function subjectLabel(scan: PendingScan, people: ScannerPerson[]): string | null {
  const person = findSubject(scan, people);
  if (!person) return null;
  return [person.name, person.surname].filter(Boolean).join(" ") || person.email;
}

export function detailLabel(
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
    case "presence_signal":
      return `#${p.userId} · ${p.direction === "in" ? t("presenceSignalEntry") : t("presenceSignalExit")}`;
    case "presence_signal_activity":
      return `#${p.userId} · ${activities.find((a) => a.id === p.activityId)?.name ?? `#${p.activityId}`}`;
    case "presence_signal_edit_door":
      return `${t("edit")} · #${p.logId}`;
    case "presence_signal_edit_activity":
      return `${t("edit")} · #${p.logId}`;
    case "presence_signal_delete": {
      const context =
        p.source === "door"
          ? p.direction
            ? p.direction === "in"
              ? t("presenceSignalEntry")
              : t("presenceSignalExit")
            : null
          : p.activityId == null
            ? null
            : (activities.find((activity) => activity.id === p.activityId)?.name ??
              `#${p.activityId}`);
      return [
        t("delete"),
        p.source === "door" ? t("scannerPresence") : t("scannerActivity"),
        `#${p.logId}`,
        context,
        p.badgeId ? `${t("scannerFieldBadge")}: ${p.badgeId}` : null,
      ]
        .filter(Boolean)
        .join(" · ");
    }
  }
}

export function scannerOperationLabel(
  scan: PendingScan,
  t: ReturnType<typeof useLocale>["t"],
): string {
  switch (scan.kind) {
    case "activity":
      return t("scannerActivity");
    case "presence":
    case "presence_signal":
    case "presence_signal_activity":
      return t("scannerPresence");
    case "presence_signal_edit_door":
    case "presence_signal_edit_activity":
    case "presence_signal_delete":
      return t("scannerPresenceLog");
    case "accreditation":
    case "accreditation_user":
      return t("scannerAccreditation");
    case "badge_rotation":
    case "badge_removal":
      return t("scannerBadge");
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
  } else if ("userId" in p && typeof p.userId === "number") {
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
    case "presence_signal":
      details.push({
        label: t("scannerFieldDirection"),
        value: p.direction === "in" ? t("presenceSignalEntry") : t("presenceSignalExit"),
      });
      details.push({
        label: t("scannerFieldTimestamp"),
        value: new Date(p.occurredAt).toLocaleString(),
      });
      break;
    case "presence_signal_activity": {
      const activity = activities.find((a) => a.id === p.activityId);
      details.push({
        label: t("scannerFieldActivity"),
        value: activity ? `${activity.name} (#${p.activityId})` : `#${p.activityId}`,
      });
      details.push({
        label: t("scannerFieldTimestamp"),
        value: new Date(p.occurredAt).toLocaleString(),
      });
      break;
    }
    case "presence_signal_edit_door":
      details.push({ label: t("scannerFieldLogId"), value: String(p.logId) });
      if (p.direction) {
        details.push({
          label: t("scannerFieldDirection"),
          value: p.direction === "in" ? t("presenceSignalEntry") : t("presenceSignalExit"),
        });
      }
      if (p.occurredAt) {
        details.push({
          label: t("scannerFieldTimestamp"),
          value: new Date(p.occurredAt).toLocaleString(),
        });
      }
      break;
    case "presence_signal_edit_activity": {
      details.push({ label: t("scannerFieldLogId"), value: String(p.logId) });
      const activity = activities.find((a) => a.id === p.activityId);
      if (p.activityId != null) {
        details.push({
          label: t("scannerFieldActivity"),
          value: activity ? `${activity.name} (#${p.activityId})` : `#${p.activityId}`,
        });
      }
      if (p.occurredAt) {
        details.push({
          label: t("scannerFieldTimestamp"),
          value: new Date(p.occurredAt).toLocaleString(),
        });
      }
      break;
    }
    case "presence_signal_delete":
      if (p.badgeId ?? subject?.badgeId) {
        details.push({
          label: t("scannerFieldBadge"),
          value: p.badgeId ?? subject?.badgeId ?? "",
        });
      }
      details.push({
        label: t("scannerFieldSource"),
        value: p.source === "door" ? t("scannerPresence") : t("scannerActivity"),
      });
      details.push({ label: t("scannerFieldLogId"), value: String(p.logId) });
      if (p.source === "door" && p.direction) {
        details.push({
          label: t("scannerFieldDirection"),
          value: p.direction === "in" ? t("presenceSignalEntry") : t("presenceSignalExit"),
        });
      }
      if (p.source === "activity" && p.activityId != null) {
        const activity = activities.find((item) => item.id === p.activityId);
        details.push({
          label: t("scannerFieldActivity"),
          value: activity ? `${activity.name} (#${p.activityId})` : `#${p.activityId}`,
        });
      }
      if (p.occurredAt) {
        details.push({
          label: t("scannerFieldTimestamp"),
          value: new Date(p.occurredAt).toLocaleString(),
        });
      }
      if (p.notes) details.push({ label: t("scannerFieldNotes"), value: p.notes });
      break;
  }
  return details;
}

export function ManualLogDetails({
  scan,
  people,
  activities,
  showHint = true,
}: {
  scan: PendingScan;
  people: ScannerPerson[];
  activities: ScannerActivity[];
  showHint?: boolean;
}) {
  const { t } = useLocale();
  const details = manualLogDetails(scan, people, activities, t);
  return (
    <View style={{ gap: 8 }}>
      {showHint ? (
        <Text style={{ color: colors.secondaryLabel, fontSize: 12, lineHeight: 16 }}>
          {t("scannerManualLogHint")}
        </Text>
      ) : null}
      <View
        style={{
          backgroundColor: colors.background,
          borderCurve: "continuous",
          borderRadius: 10,
          overflow: "hidden",
        }}
      >
        {details.map((detail, index) => (
          <View
            key={detail.label}
            style={{
              borderTopColor: colors.separator,
              borderTopWidth: index === 0 ? 0 : 1,
              flexDirection: "row",
              gap: 8,
              paddingHorizontal: 10,
              paddingVertical: 8,
            }}
          >
            <Text style={{ color: colors.secondaryLabel, fontSize: 13, width: 88 }}>
              {detail.label}
            </Text>
            <Text
              selectable
              style={{ color: colors.label, flex: 1, fontSize: 13, fontWeight: "600" }}
            >
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
        onPress={() => {
          void haptic("warning");
          onDelete();
        }}
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
            }}
          >
            {scan.status === "failed"
              ? `${t("scannerBusinessRejected")}: ${scan.lastError}`
              : t("scannerOfflineWaiting")}
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
  onRetryOne,
  onDelete,
  clockSkewMs = null,
  fillWidth = false,
}: {
  queue: PendingScan[];
  syncing: boolean;
  clockSkewMs?: number | null;
  onSync: () => void;
  onRetry: () => void;
  onRetryOne: (id: string) => void;
  onDelete: (id: string) => void;
  fillWidth?: boolean;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // Android has no page-sheet presentation: the modal is full-screen, so its
  // chrome has to clear the status bar itself.
  const sheetTopInset = process.env.EXPO_OS === "android" ? insets.top : 0;
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
  return (
    <>
      <GlassView
        colorScheme="dark"
        glassEffectStyle="regular"
        isInteractive
        style={{
          alignSelf: fillWidth ? "stretch" : "center",
          borderRadius: 999,
          minHeight: 44,
          overflow: "hidden",
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          onPress={() => setOpen(true)}
          style={({ pressed }) => ({
            alignItems: "center",
            flexDirection: "row",
            gap: 8,
            justifyContent: "center",
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
      </GlassView>
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
              paddingTop: 16 + sheetTopInset,
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
                          // The swipe gesture that reveals delete has no VoiceOver/
                          // TalkBack/switch-control path, so it stays reachable as a
                          // non-visual accessibility action here instead of a second
                          // always-visible delete button next to the retry one below.
                          accessibilityActions={
                            deletable
                              ? [{ name: "delete", label: t("scannerDeleteScan") }]
                              : undefined
                          }
                          onAccessibilityAction={(event) => {
                            if (deletable && event.nativeEvent.actionName === "delete") {
                              void haptic("warning");
                              onDelete(scan.id);
                            }
                          }}
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
                              {subject ?? scannerOperationLabel(scan, t)}
                            </Text>
                            <Text style={{ color: colors.secondaryLabel, fontSize: 12 }}>
                              {new Date(scan.createdAt).toLocaleTimeString()}
                            </Text>
                          </View>
                          <Text style={{ color: colors.secondaryLabel, fontSize: 13 }}>
                            {scannerOperationLabel(scan, t)} · {detailLabel(scan, activities, t)}
                            {scan.attempts > 1
                              ? ` · ${t("scannerAttemptsCount", { count: String(scan.attempts) })}`
                              : ""}
                          </Text>
                          {deletable ? (
                            <View
                              style={{
                                borderTopColor: colors.separator,
                                borderTopWidth: 1,
                                gap: 10,
                                marginTop: 4,
                                paddingTop: 10,
                              }}
                            >
                              <ScannerTransactionStatus scan={scan} bare />
                              <ManualLogDetails
                                scan={scan}
                                people={people}
                                activities={activities}
                              />
                              {/* Discarding this entry is only reachable by swiping the row
                                  (above) — a second, always-visible delete button here was
                                  redundant with it. This stays the always-visible action for
                                  a single entry instead: a retry that doesn't wait for
                                  "Retry rejected scans" to sweep every failed scan in the
                                  queue. */}
                              <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={t("retry")}
                                onPress={() => {
                                  void haptic("light");
                                  onRetryOne(scan.id);
                                }}
                                style={({ pressed }) => ({
                                  alignItems: "center",
                                  alignSelf: "flex-end",
                                  backgroundColor: colors.accent,
                                  borderCurve: "continuous",
                                  borderRadius: 10,
                                  flexDirection: "row",
                                  gap: 6,
                                  minHeight: 34,
                                  opacity: pressed ? 0.75 : 1,
                                  paddingHorizontal: 14,
                                })}
                              >
                                <SymbolView
                                  accessible={false}
                                  name="arrow.clockwise"
                                  size={13}
                                  tintColor="white"
                                />
                                <Text
                                  style={{
                                    color: "white",
                                    fontSize: 13,
                                    fontWeight: "700",
                                  }}
                                >
                                  {t("retry")}
                                </Text>
                              </Pressable>
                            </View>
                          ) : (
                            <ScannerTransactionStatus scan={scan} bare />
                          )}
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
                  router.push({
                    pathname: SCAN_LOG_ROUTES.scanner,
                    params: { from: "scanner" },
                  });
                }}
              />
            </Section>
          </ScrollView>

          <FloatingGlassButton
            top={16 + sheetTopInset}
            side="left"
            icon="xmark"
            accessibilityLabel={t("close")}
            onPress={() => setOpen(false)}
          />
          <FloatingGlassButton
            top={16 + sheetTopInset}
            side="right"
            icon={hasAttention ? "exclamationmark.arrow.circlepath" : "arrow.triangle.2.circlepath"}
            tintColor={hasAttention ? colors.destructive : colors.accent}
            accessibilityLabel={hasAttention ? t("scannerRetryFailed") : t("scannerSync")}
            accessibilityState={{ busy: syncing }}
            disabled={syncing}
            onPress={() => {
              void haptic("light");
              (hasAttention ? onRetry : onSync)();
            }}
          />
        </View>
      </Modal>
    </>
  );
}
