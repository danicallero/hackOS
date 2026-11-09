import { View } from "react-native";
import { AppText as Text } from "@/components/app-text";
import { SymbolView } from "@/components/symbol";
import { useLocale } from "@/lib/i18n";
import { type } from "@/theme";
import { colors } from "@/theme/colors";

/** Scanning keeps working offline: a quiet note, never an error banner. */
export function OfflineScanningNote() {
  const { t } = useLocale();
  return (
    <View accessibilityRole="text" style={{ alignItems: "center", flexDirection: "row", gap: 6 }}>
      <SymbolView name="wifi.slash" size={14} tintColor={colors.secondaryLabel} />
      <Text style={[type.footnote, { color: colors.secondaryLabel }]}>
        {t("scannerOfflineScanning")}
      </Text>
    </View>
  );
}
