import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GlassView } from "@/components/glass-view";
import { LegacyHeaderIconButton } from "@/components/native-ui";
import { useLocale } from "@/lib/i18n";
import { radius } from "@/theme";

/**
 * The back control pinned to a hero screen's top-left corner: the same 44pt
 * liquid-glass circle as the native bar's, drawn in the screen itself (like
 * Luma) so it rides along with the screen while a zoom transition slides.
 */
export function FloatingBackButton({ onPress }: { onPress: () => void }) {
  const { t } = useLocale();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ left: 16, position: "absolute", top: insets.top + 8, zIndex: 10 }}>
      <GlassView
        colorScheme="auto"
        glassEffectStyle="regular"
        isInteractive
        style={{ borderRadius: radius.full, height: 44, width: 44 }}
      >
        <LegacyHeaderIconButton
          accessibilityLabel={t("back")}
          icon="chevron.left"
          onPress={onPress}
        />
      </GlassView>
    </View>
  );
}
