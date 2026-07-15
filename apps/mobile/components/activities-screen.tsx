import { useFocusEffect, useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, Pressable, RefreshControl, Text, useColorScheme, View } from "react-native";

import { EmptyState, StatusPill } from "@/components/native-ui";
import { useLocale } from "@/lib/i18n";
import { listScannerActivities } from "@/lib/scanner-db";
import type { ScannerActivity } from "@/lib/scanner-types";
import { useScannerSync } from "@/lib/use-scanner";
import { colors } from "@/theme/colors";

export function ActivitiesScreen() {
  useColorScheme();
  const router = useRouter();
  const { t } = useLocale();
  const sync = useScannerSync();
  const [items, setItems] = useState<ScannerActivity[]>([]);
  const listRef = useRef<FlatList<ScannerActivity>>(null);
  const load = useCallback(
    async () =>
      setItems(
        (await listScannerActivities()).filter(
          (item) => item.requiresScan || item.category === "meal",
        ),
      ),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (sync.lastSync) void load();
  }, [load, sync.lastSync]);

  // Forces the FlatList back to the top on focus so the native large-title
  // header re-syncs its collapsed/expanded state with the actual scroll
  // offset — otherwise returning from a pushed screen can leave the header
  // (and therefore the list start) stuck lower than it should be.
  useFocusEffect(
    useCallback(() => {
      listRef.current?.scrollToOffset({ offset: 0, animated: false });
    }, []),
  );

  return (
    <FlatList
      ref={listRef}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ flexGrow: 1, padding: 16, paddingBottom: 32 }}
      data={items}
      keyExtractor={(item) => String(item.id)}
      refreshControl={
        <RefreshControl refreshing={sync.syncing} onRefresh={() => void sync.sync().then(load)} />
      }
      ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
      ListEmptyComponent={
        <EmptyState
          icon="qrcode.viewfinder"
          title={t("scannerActivitiesEmpty")}
          description={t("scannerActivitiesEmptyBody")}
        />
      }
      renderItem={({ item }) => (
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            router.push({
              pathname: "/(tabs)/others/activities/[id]",
              params: { id: String(item.id) },
            })
          }
          style={({ pressed }) => ({
            alignItems: "center",
            backgroundColor: colors.elevatedSurface,
            borderCurve: "continuous",
            borderRadius: 999,
            boxShadow: "0 2px 8px rgba(0, 0, 0, 0.08)",
            flexDirection: "row",
            gap: 12,
            minHeight: 64,
            opacity: pressed ? 0.65 : 1,
            paddingHorizontal: 12,
            paddingVertical: 10,
          })}
        >
          <View
            style={{
              alignItems: "center",
              backgroundColor: colors.accentSurface,
              borderRadius: 999,
              height: 42,
              justifyContent: "center",
              width: 42,
            }}
          >
            <SymbolView
              name={item.category === "meal" ? "fork.knife" : "list.bullet.rectangle"}
              tintColor={colors.accent}
              size={22}
            />
          </View>
          <Text
            selectable
            numberOfLines={1}
            style={{ color: colors.label, flex: 1, fontSize: 17, fontWeight: "700" }}
          >
            {item.name}
          </Text>
          <StatusPill tone={item.category === "meal" ? "warning" : "accent"}>
            {item.category === "meal" ? t("scannerMeal") : t("scannerActivity")}
          </StatusPill>
          <SymbolView name="chevron.right" tintColor={colors.tertiaryLabel} size={15} />
        </Pressable>
      )}
    />
  );
}
