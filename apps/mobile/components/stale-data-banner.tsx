import { Text, View } from "react-native";
import { SymbolView } from "@/components/symbol";
import { formatLastUpdate } from "@/lib/format-date";
import { useLocale } from "@/lib/i18n";
import { colors } from "@/theme/colors";
import { type } from "@/theme/tokens";

/**
 * Shown whenever a screen is displaying cached data because the server
 * didn't respond. Dismissed by refreshing the data itself (pull-to-refresh),
 * not by a button on the banner.
 */
export function StaleDataBanner({ updatedAt }: { updatedAt: string | null }) {
  const { language, t } = useLocale();
  if (!updatedAt) return null;
  const formatted = formatLastUpdate(updatedAt, language, t);

  // Neutral and quiet, but a visible capsule: no warning colour, one line.
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        alignItems: "center",
        alignSelf: "stretch",
        backgroundColor: colors.hover,
        borderCurve: "continuous",
        borderRadius: 999,
        flexDirection: "row",
        gap: 8,
        marginBottom: 14,
        paddingHorizontal: 14,
        paddingVertical: 10,
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
