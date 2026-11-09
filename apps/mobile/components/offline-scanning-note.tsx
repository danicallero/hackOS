import { useEffect, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, View } from "react-native";
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
  // One slot holds the label, the spinner and the cross, cross-fading in place so the
  // note never changes width while it works.
  const fades = useRef({
    idle: new Animated.Value(1),
    loading: new Animated.Value(0),
    failed: new Animated.Value(0),
  }).current;
  useEffect(() => {
    Animated.parallel(
      (["idle", "loading", "failed"] as const).map((key) =>
        Animated.timing(fades[key], {
          toValue: state === key ? 1 : 0,
          duration: 200,
          useNativeDriver: true,
        }),
      ),
    ).start();
  }, [fades, state]);
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
      <Text style={textStyle}>{t("scannerOfflineMode")}</Text>
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
        <View style={{ alignItems: "center", justifyContent: "center" }}>
          <Animated.View style={{ opacity: fades.idle }}>
            <Text style={textStyle}>{t("scannerReconnect")}</Text>
          </Animated.View>
          <Animated.View pointerEvents="none" style={[styles.overlay, { opacity: fades.loading }]}>
            <AppActivityIndicator size={14} />
          </Animated.View>
          <Animated.View
            pointerEvents="none"
            style={[
              styles.overlay,
              {
                opacity: fades.failed,
                transform: [
                  {
                    scale: fades.failed.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }),
                  },
                ],
              },
            ]}
          >
            <SymbolView name="xmark.circle.fill" size={14} tintColor={colors.destructive} />
          </Animated.View>
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    alignItems: "center",
    justifyContent: "center",
  },
});
