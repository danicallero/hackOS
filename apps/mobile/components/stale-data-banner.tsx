import { Text, View } from "react-native";
import { SymbolView } from "@/components/symbol";
import { formatLastUpdate } from "@/lib/format-date";
import { useLocale } from "@/lib/i18n";
import { useMeContext } from "@/lib/me-context";
import { colors } from "@/theme/colors";
import { type } from "@/theme/tokens";

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

  // Quiet, like the scanner's offline note: one grey line, no card, no warning colour.
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        alignItems: "center",
        flexDirection: "row",
        gap: 6,
        marginBottom: 14,
        paddingRight: hasOperationsMenu ? 72 : 0,
      }}
    >
      <SymbolView
        name="wifi.slash"
        size={14}
        tintColor={colors.secondaryLabel}
        accessible={false}
      />
      <Text
        selectable
        style={{ color: colors.secondaryLabel, flex: 1, fontSize: type.footnote.fontSize }}
      >
        {t("offlineDataLine", { updatedAt: formatted })}
      </Text>
    </View>
  );
}
