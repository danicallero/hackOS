import { usePathname, useRouter } from "expo-router";
import { Stack } from "expo-router/stack";
import { useCallback, useState } from "react";
import { Pressable, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GlassView } from "@/components/glass-view";
import { AdaptiveToolbarButton } from "@/components/native-ui";
import { QrCamera } from "@/components/QrCamera";
import { ScannerQueueStatus } from "@/components/scanner-transaction-status";
import { SymbolView } from "@/components/symbol";
import { useLocale } from "@/lib/i18n";
import { findPersonByBadge, findPersonByTicket } from "@/lib/scanner-db";
import { useScannerSync } from "@/lib/use-scanner";
import { colors } from "@/theme/colors";

export function GeneralScannerScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const usesTopTabBar = process.env.EXPO_OS === "ios" && width >= 700;
  const pathname = usePathname();
  const { t } = useLocale();
  const insets = useSafeAreaInsets();
  const [error, setError] = useState<string | null>(null);
  const sync = useScannerSync();

  const resolve = useCallback(
    async (raw: string) => {
      const value = raw.trim();
      const byTicket = await findPersonByTicket(value);
      const badge = byTicket ? null : await findPersonByBadge(value);
      const person = byTicket ?? badge?.person ?? null;
      if (!person) {
        setError(badge?.revoked ? t("scannerBadgeRevoked") : t("scannerUnknownQr"));
        return;
      }
      setError(null);
      router.push({
        pathname: "/(tabs)/scan/person/[id]",
        params: { id: String(person.userId) },
      });
    },
    [router, t],
  );

  return (
    <View style={{ backgroundColor: "black", flex: 1 }}>
      <Stack.Screen options={{ headerTitle: "" }} />
      <QrCamera
        onClose={pathname === "/scan" ? undefined : () => router.back()}
        onValue={(value) => void resolve(value)}
      />
      <AdaptiveToolbarButton
        top={insets.top + 12}
        side="right"
        icon="person.crop.badge.magnifyingglass"
        tintColor="white"
        accessibilityLabel={t("scannerViewPeople")}
        onPress={() => router.push("/(tabs)/scan/people")}
      />
      <View
        pointerEvents="box-none"
        style={{
          left: 72,
          position: "absolute",
          right: 72,
          top: insets.top + (usesTopTabBar ? 72 : 12),
        }}
      >
        <ScannerQueueStatus
          queue={sync.queue}
          syncing={sync.syncing}
          onSync={() => void sync.sync()}
          onRetry={() => void sync.retryFailed()}
          onDelete={(id) => void sync.discardScan(id)}
          clockSkewMs={sync.clockSkewMs}
        />
      </View>
      {error ? (
        <GlassView
          colorScheme="dark"
          glassEffectStyle="regular"
          style={{
            borderRadius: 14,
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
            onPress={() => setError(null)}
            accessibilityLiveRegion="assertive"
            style={{ alignItems: "center", flex: 1, flexDirection: "row", gap: 9, padding: 14 }}
          >
            <SymbolView name="xmark.circle.fill" tintColor={colors.destructive} size={20} />
            <Text selectable style={{ color: "white", flex: 1, fontSize: 16, fontWeight: "700" }}>
              {error}
            </Text>
          </Pressable>
        </GlassView>
      ) : null}
    </View>
  );
}
