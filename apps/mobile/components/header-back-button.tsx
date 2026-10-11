import { Pressable } from "react-native";

import { SymbolView } from "@/components/symbol";
import { haptic } from "@/lib/haptics";
import { useLocale } from "@/lib/i18n";
import { colors } from "@/theme/colors";

/**
 * Back action for a native header `headerLeft`, used only when the route has
 * no stack entry to pop (cold deep link) and the native back item would be
 * missing. UIKit wraps a custom bar item in a glass platter sized to its
 * content plus horizontal padding: a 44pt-wide frame becomes a capsule, while
 * the bare symbol (hit area extended by `hitSlop`) becomes the same circle as
 * the native back button and header icon actions.
 */
export function HeaderBackButton({ onPress }: { onPress: () => void }) {
  const { t } = useLocale();
  return (
    <Pressable
      accessibilityLabel={t("back")}
      accessibilityRole="button"
      hitSlop={12}
      onPress={() => {
        void haptic("light");
        onPress();
      }}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
    >
      <SymbolView
        accessible={false}
        name="chevron.left"
        size={20}
        tintColor={colors.label}
        weight="semibold"
      />
    </Pressable>
  );
}
