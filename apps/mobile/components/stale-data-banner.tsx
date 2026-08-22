import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { SymbolView } from "@/components/symbol";

import { haptic } from "@/lib/haptics";
import { useLocale } from "@/lib/i18n";
import { useMeContext } from "@/lib/me-context";
import { colors } from "@/theme/colors";

export function StaleDataBanner({
  updatedAt,
  onRetry,
  retrying = false,
}: {
  updatedAt: string | null;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  const { language, t } = useLocale();
  const { me } = useMeContext();
  if (!updatedAt) return null;
  const capabilities = me?.capabilities ?? [];
  const hasOperationsMenu =
    capabilities.includes("*") ||
    capabilities.some((capability) =>
      ["accredit:scan", "presence:scan", "activity:scan"].includes(capability),
    );

  const timestamp = new Date(updatedAt);
  const formatted = Number.isNaN(timestamp.getTime())
    ? updatedAt
    : timestamp.toLocaleString(language, {
        dateStyle: "short",
        timeStyle: "short",
      });

  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        alignItems: "flex-start",
        backgroundColor: colors.warningSurface,
        borderCurve: "continuous",
        borderRadius: 14,
        flexDirection: "row",
        gap: 10,
        marginBottom: 14,
        padding: 13,
        paddingRight: hasOperationsMenu ? 72 : 13,
      }}
    >
      <SymbolView
        name="exclamationmark.triangle.fill"
        tintColor={colors.onWarningSurface}
        size={20}
        accessible={false}
      />
      <View style={{ flex: 1, gap: 3 }}>
        <Text
          selectable
          style={{ color: colors.onWarningSurface, fontSize: 15, fontWeight: "700" }}
        >
          {t("offlineDataTitle")}
        </Text>
        <Text selectable style={{ color: colors.onWarningSurface, fontSize: 13, lineHeight: 18 }}>
          {t("offlineDataBody", { updatedAt: formatted })}
        </Text>
        {onRetry ? (
          <Pressable
            accessibilityLabel={t("retry")}
            accessibilityRole="button"
            accessibilityState={{ busy: retrying, disabled: retrying }}
            disabled={retrying}
            onPress={() => {
              void haptic("light");
              onRetry();
            }}
            style={({ pressed }) => ({
              alignItems: "center",
              alignSelf: "flex-start",
              flexDirection: "row",
              gap: 6,
              justifyContent: "center",
              minHeight: 44,
              opacity: retrying ? 0.5 : pressed ? 0.7 : 1,
              paddingHorizontal: 4,
            })}
          >
            {retrying ? <ActivityIndicator color={colors.onWarningSurface} size="small" /> : null}
            <Text style={{ color: colors.onWarningSurface, fontSize: 14, fontWeight: "700" }}>
              {t("retry")}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
