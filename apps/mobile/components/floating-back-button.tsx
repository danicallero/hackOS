import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SymbolView } from "@/components/symbol";
import { haptic } from "@/lib/haptics";
import { useLocale } from "@/lib/i18n";
import { colors, radius } from "@/theme";

/**
 * The back control pinned to a hero screen's top-left corner, drawn in the
 * screen itself (like Luma) instead of in the native header: a zoom transition
 * whose dismiss swipe is cancelled can leave the native button, or a glass
 * effect, hidden. A plain translucent disc has neither problem and rides along
 * with the screen while it slides.
 */
export function FloatingBackButton({ onPress }: { onPress: () => void }) {
  const { t } = useLocale();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ left: 16, position: "absolute", top: insets.top + 8, zIndex: 10 }}>
      <Pressable
        accessibilityLabel={t("back")}
        accessibilityRole="button"
        onPress={() => {
          void haptic("light");
          onPress();
        }}
        style={({ pressed }) => ({
          alignItems: "center",
          backgroundColor: colors.elevatedSurface,
          borderColor: colors.separator,
          borderRadius: radius.full,
          borderWidth: 1,
          boxShadow: "0 2px 8px rgba(0, 0, 0, 0.18)",
          height: 44,
          justifyContent: "center",
          opacity: pressed ? 0.6 : 0.92,
          width: 44,
        })}
      >
        <SymbolView
          accessible={false}
          name="chevron.left"
          tintColor={colors.label}
          size={19}
          weight="semibold"
        />
      </Pressable>
    </View>
  );
}
