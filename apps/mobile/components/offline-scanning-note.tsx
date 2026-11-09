import { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { AppActivityIndicator } from "@/components/app-activity-indicator";
import { AppText as Text } from "@/components/app-text";
import { SymbolView } from "@/components/symbol";
import { useLocale } from "@/lib/i18n";
import { type } from "@/theme";
import { colors } from "@/theme/colors";

const FAILED_VISIBLE_MS = 3000;

/**
 * Scanning keeps working offline: a quiet note, never an error banner. Reconnect
 * retries once (a spinner while it runs) and shows a red cross for a moment if it fails.
 */
export function OfflineScanningNote({ onReconnect }: { onReconnect: () => Promise<boolean> }) {
  const { t } = useLocale();
  const [state, setState] = useState<"idle" | "loading" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function reconnect() {
    if (state !== "idle") return;
    setState("loading");
    const ok = await onReconnect().catch(() => false);
    if (ok) {
      setState("idle");
      return;
    }
    setState("failed");
    timer.current = setTimeout(() => setState("idle"), FAILED_VISIBLE_MS);
  }

  const textStyle = [type.footnote, { color: colors.secondaryLabel }];
  return (
    <View style={{ alignItems: "center", flexDirection: "row", gap: 6 }}>
      <SymbolView name="wifi.slash" size={14} tintColor={colors.secondaryLabel} />
      <Text style={textStyle}>{t("scannerOfflineScanning")}</Text>
      <Text style={textStyle}>·</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("scannerReconnect")}
        accessibilityState={{ busy: state === "loading" }}
        disabled={state !== "idle"}
        hitSlop={8}
        onPress={() => void reconnect()}
        style={{ alignItems: "center", flexDirection: "row", gap: 6 }}
      >
        {state === "loading" ? (
          <AppActivityIndicator size={14} />
        ) : state === "failed" ? (
          <SymbolView name="xmark.circle.fill" size={14} tintColor={colors.destructive} />
        ) : (
          <Text style={[type.footnote, { color: colors.accent }]}>{t("scannerReconnect")}</Text>
        )}
      </Pressable>
    </View>
  );
}
