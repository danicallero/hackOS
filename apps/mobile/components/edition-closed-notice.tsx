import { useColorScheme, View } from "react-native";
import { AppText as Text } from "@/components/app-text";
import { SymbolView } from "@/components/symbol";
import { useLocale } from "@/lib/i18n";
import { useMeContext } from "@/lib/me-context";
import { radius, type } from "@/theme";
import { colors } from "@/theme/colors";

/** One compact line while the viewed edition is closed: everything stays readable, nothing is editable. */
export function EditionClosedNotice() {
  useColorScheme();
  const { t } = useLocale();
  const { me } = useMeContext();
  const edition = me?.edition;
  if (edition?.status !== "closed") return null;
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        alignItems: "center",
        alignSelf: "stretch",
        backgroundColor: colors.hover,
        borderCurve: "continuous",
        borderRadius: radius.sheet,
        flexDirection: "row",
        gap: 8,
        minHeight: 36,
        paddingHorizontal: 14,
        paddingVertical: 8,
      }}
    >
      <SymbolView name="lock.fill" size={14} tintColor={colors.secondaryLabel} accessible={false} />
      <Text style={[type.footnote, { color: colors.secondaryLabel, flex: 1 }]}>
        {t("editionClosedNotice", { name: edition.name })}
      </Text>
    </View>
  );
}
