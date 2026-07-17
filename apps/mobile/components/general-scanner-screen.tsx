import { GlassView } from "expo-glass-effect";
import { usePathname, useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { QrCamera } from "@/components/QrCamera";
import { ScannerQueueStatus } from "@/components/scanner-transaction-status";
import { useLocale } from "@/lib/i18n";
import { findPersonByBadge, findPersonByTicket } from "@/lib/scanner-db";
import { useScannerSync } from "@/lib/use-scanner";
import { colors } from "@/theme/colors";

export function GeneralScannerScreen() {
  const router = useRouter();
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
        pathname: "/(tabs)/others/scan/person/[id]",
        params: { id: String(person.userId) },
      });
    },
    [router, t],
  );

  return (
    <View style={{ backgroundColor: "black", flex: 1 }}>
      <QrCamera
        onClose={pathname === "/others/scan" ? undefined : () => router.back()}
        onValue={(value) => void resolve(value)}
      />
      <GlassView
        colorScheme="dark"
        glassEffectStyle="regular"
        isInteractive
        style={{
          borderRadius: 22,
          height: 44,
          position: "absolute",
          right: 16,
          top: insets.top + 12,
          width: 44,
        }}
      >
        <Pressable
          accessibilityLabel={t("scannerViewPeople")}
          accessibilityRole="button"
          onPress={() => router.push("/(tabs)/others/scan/people")}
          style={{ alignItems: "center", flex: 1, justifyContent: "center" }}
        >
          <SymbolView name="list.bullet" tintColor="white" size={19} weight="semibold" />
        </Pressable>
      </GlassView>
      <View
        pointerEvents="box-none"
        style={{ left: 72, position: "absolute", right: 72, top: insets.top + 12 }}
      >
        <ScannerQueueStatus
          queue={sync.queue}
          syncing={sync.syncing}
          onSync={() => void sync.sync()}
          onRetry={() => void sync.retryFailed()}
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
