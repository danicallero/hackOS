import { Text, View } from "react-native";
import { SymbolView } from "@/components/symbol";

import { formatLastUpdate } from "@/lib/format-date";
import { useLocale } from "@/lib/i18n";
import { useMeContext } from "@/lib/me-context";
import { colors } from "@/theme/colors";

/**
 * Shown whenever a screen is displaying cached data because the server
 * didn't respond. Dismissed by refreshing the data itself (pull-to-refresh),
 * not by a button on the banner.
 */
export function StaleDataBanner({ updatedAt }: { updatedAt: string | null }) {
  const { language, t } = useLocale();
  const { me } = useMeContext();
  if (!updatedAt) return null;
  const capabilities = me?.capabilities ?? [];
  const hasOperationsMenu =
    capabilities.includes("*") ||
    capabilities.some((capability) =>
      ["accredit:scan", "presence:scan", "activity:scan"].includes(capability),
    );

  const formatted = formatLastUpdate(updatedAt, language, t);

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
      </View>
    </View>
  );
}
