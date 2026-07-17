import { useRouter } from "expo-router";
import { SymbolView, type SymbolViewProps } from "expo-symbols";
import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ActionButton, FloatingGlassButton, Section } from "@/components/native-ui";
import { useLocale } from "@/lib/i18n";
import { listScannerActivities, listScannerPeople } from "@/lib/scanner-db";
import { scannerQueueHealth, scannerTransactionState } from "@/lib/scanner-state";
import type { PendingScan, ScannerActivity, ScannerPerson } from "@/lib/scanner-types";
import { colors } from "@/theme/colors";

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

export function ScannerTransactionStatus({ scan }: { scan?: PendingScan | null }) {
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
      style={{
        alignItems: "center",
        backgroundColor: colors.surface,
        borderCurve: "continuous",
        borderRadius: 14,
        flexDirection: "row",
        gap: 10,
        minHeight: 50,
        paddingHorizontal: 14,
      }}
    >
      <SymbolView
        accessible={false}
        name={presentation.icon as SymbolViewProps["name"]}
        size={19}
        tintColor={presentation.tone}
      />
      <View style={{ flex: 1, gap: 2, paddingVertical: 10 }}>
        <Text style={{ color: colors.label, fontSize: 15, fontWeight: "700" }}>
          {presentation.label}
        </Text>
        {scan?.lastError ? (
          <Text selectable style={{ color: colors.secondaryLabel, fontSize: 13 }}>
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
}: {
  queue: PendingScan[];
  syncing: boolean;
  onSync: () => void;
  onRetry: () => void;
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
                style={{ color: colors.label, fontSize: 20, fontWeight: "700", textAlign: "center" }}
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

            <Section title={t("scannerQueue")}>
              {queue.length === 0 ? (
                <ScannerTransactionStatus />
              ) : (
                <View style={{ gap: 10, padding: 16 }}>
                  {queue
                    .slice(-20)
                    .reverse()
                    .map((scan) => {
                      const subject = subjectLabel(scan, people);
                      return (
                        <View key={scan.id} style={{ gap: 3 }}>
                          <View
                            style={{ alignItems: "baseline", flexDirection: "row", gap: 8 }}
                          >
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
                          <ScannerTransactionStatus scan={scan} />
                        </View>
                      );
                    })}
                </View>
              )}
            </Section>

            <Section>
              <ActionButton
                label={t("scannerSeeHistory")}
                icon="clock.arrow.circlepath"
                onPress={() => {
                  setOpen(false);
                  router.push("/(tabs)/others/scan-log");
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
