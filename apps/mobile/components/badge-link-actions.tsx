import { MenuView } from "@expo/ui/community/menu";
import { UI_TEST_IDS } from "@hackos/shared/ui-test-ids";
import { Pressable, View } from "react-native";
import { GlassView } from "@/components/glass-view";
import { ActionButton } from "@/components/native-ui";
import { SymbolView } from "@/components/symbol";
import { useLocale } from "@/lib/i18n";
import { colors } from "@/theme/colors";

export function BadgeLinkActions({
  onNfc,
  onAlternative,
  disabled,
}: {
  onNfc: () => void;
  onAlternative: (method: "manual" | "qr") => void;
  disabled: boolean;
}) {
  const { t } = useLocale();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <GlassView
        isInteractive={!disabled}
        glassEffectStyle="regular"
        tintColor={colors.primaryAction}
        style={{ flex: 1, borderRadius: 25, overflow: "hidden" }}
      >
        <ActionButton
          testID={UI_TEST_IDS.scanner.linkBadge}
          icon="wave.3.right"
          label={t("personLinkBadgeNfc")}
          variant="filled"
          style={{ borderRadius: 25, backgroundColor: "transparent" }}
          disabled={disabled}
          onPress={onNfc}
        />
      </GlassView>
      <MenuView
        shouldOpenOnLongPress={false}
        actions={[
          {
            id: "qr",
            title: t("personScanBadgeCode"),
            image: "qrcode.viewfinder",
            attributes: { disabled },
          },
          {
            id: "manual",
            title: t("personEnterBadgeCode"),
            image: "keyboard",
            attributes: { disabled },
          },
        ]}
        onPressAction={({ nativeEvent }) => {
          if (!disabled && (nativeEvent.event === "manual" || nativeEvent.event === "qr"))
            onAlternative(nativeEvent.event);
        }}
      >
        <GlassView
          isInteractive={!disabled}
          glassEffectStyle="regular"
          style={{ width: 50, height: 50, borderRadius: 25, overflow: "hidden" }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("personBadgeOptions")}
            accessibilityState={{ disabled }}
            disabled={disabled}
            style={({ pressed }) => ({
              width: 50,
              minHeight: 50,
              borderRadius: 25,
              alignItems: "center",
              justifyContent: "center",
              opacity: disabled ? 0.45 : pressed ? 0.6 : 1,
            })}
          >
            <SymbolView accessible={false} name="ellipsis" tintColor={colors.accent} size={20} />
          </Pressable>
        </GlassView>
      </MenuView>
    </View>
  );
}
