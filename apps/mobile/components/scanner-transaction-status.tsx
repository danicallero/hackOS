import { SymbolView, type SymbolViewProps } from "expo-symbols";
import { useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useLocale } from "@/lib/i18n";
import { scannerQueueHealth, scannerTransactionState } from "@/lib/scanner-state";
import type { PendingScan } from "@/lib/scanner-types";
import { colors } from "@/theme/colors";

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
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const health = scannerQueueHealth(queue);
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
        <View
          accessibilityViewIsModal
          style={{
            backgroundColor: colors.background,
            flex: 1,
            paddingBottom: insets.bottom + 16,
            paddingHorizontal: 16,
            paddingTop: insets.top + 16,
          }}
        >
          <View style={{ alignItems: "center", flexDirection: "row", gap: 12, minHeight: 50 }}>
            <Text style={{ color: colors.label, flex: 1, fontSize: 22, fontWeight: "700" }}>
              {t("scannerQueue")}
            </Text>
            <Pressable
              accessibilityLabel={t("close")}
              accessibilityRole="button"
              onPress={() => setOpen(false)}
              style={{
                alignItems: "center",
                justifyContent: "center",
                minHeight: 44,
                minWidth: 44,
              }}
            >
              <SymbolView name="xmark.circle.fill" size={24} tintColor={colors.secondaryLabel} />
            </Pressable>
          </View>
          <Text style={{ color: colors.secondaryLabel, fontSize: 14, marginBottom: 12 }}>
            {health.offline > 0
              ? t("scannerOfflineCount", { count: String(health.offline) })
              : label}
          </Text>
          <ScrollView contentContainerStyle={{ gap: 10, paddingBottom: 16 }}>
            {queue.length === 0 ? (
              <ScannerTransactionStatus />
            ) : (
              queue
                .slice(-20)
                .reverse()
                .map((scan) => (
                  <View key={scan.id} style={{ gap: 5 }}>
                    <Text style={{ color: colors.secondaryLabel, fontSize: 13, fontWeight: "600" }}>
                      {operationLabel(scan)} · {new Date(scan.createdAt).toLocaleTimeString()}
                    </Text>
                    <ScannerTransactionStatus scan={scan} />
                  </View>
                ))
            )}
          </ScrollView>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ busy: syncing, disabled: syncing }}
            disabled={syncing}
            onPress={hasAttention ? onRetry : onSync}
            style={({ pressed }) => ({
              alignItems: "center",
              backgroundColor: colors.accent,
              borderCurve: "continuous",
              borderRadius: 14,
              justifyContent: "center",
              minHeight: 50,
              opacity: syncing ? 0.45 : pressed ? 0.65 : 1,
              paddingHorizontal: 16,
            })}
          >
            <Text style={{ color: colors.accentText, fontSize: 16, fontWeight: "700" }}>
              {syncing
                ? t("scannerSyncing")
                : hasAttention
                  ? t("scannerRetryFailed")
                  : t("scannerSync")}
            </Text>
          </Pressable>
        </View>
      </Modal>
    </>
  );
}
