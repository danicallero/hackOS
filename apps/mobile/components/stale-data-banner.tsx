import { Text, View } from "react-native";
import { SymbolView } from "@/components/symbol";

import { useLocale } from "@/lib/i18n";
import { useMeContext } from "@/lib/me-context";
import { colors } from "@/theme/colors";

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

  const timestamp = new Date(updatedAt);
  const formatted = Number.isNaN(timestamp.getTime())
    ? updatedAt
    : timestamp.toLocaleString(language, {
        dateStyle: "short",
        timeStyle: "short",
      });

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
        marginBottom: 14,
        padding: 13,
        paddingRight: hasOperationsMenu ? 72 : 13,
      }}
    >
      <SymbolView
        name="exclamationmark.triangle.fill"
        tintColor={colors.warning}
        size={20}
        accessible={false}
      />
      <View style={{ flex: 1, gap: 3 }}>
        <Text selectable style={{ color: colors.warning, fontSize: 15, fontWeight: "700" }}>
          {t("offlineDataTitle")}
        </Text>
        <Text selectable style={{ color: colors.warning, fontSize: 13, lineHeight: 18 }}>
          {t("offlineDataBody", { updatedAt: formatted })}
        </Text>
      </View>
    </View>
  );
}
