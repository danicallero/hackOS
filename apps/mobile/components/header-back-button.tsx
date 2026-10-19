import { useNavigation, useRouter } from "expo-router";
import Stack from "expo-router/stack";
import { Pressable } from "react-native";

import { isRealLiquidGlassAvailable } from "@/components/glass-view";
import { SymbolView } from "@/components/symbol";
import { haptic } from "@/lib/haptics";
import { useLocale } from "@/lib/i18n";
import { safeBack } from "@/lib/navigation";
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

/**
 * Back for the first screen of a stack, when the native back item is absent.
 * A symbol toolbar item is the form the system can move into a vertical bar on
 * a foldable iPhone; the custom `HeaderBackButton` cannot be moved.
 */
export function EntryBackToolbar({ fallback }: { fallback: Parameters<typeof safeBack>[1] }) {
  const { t } = useLocale();
  const router = useRouter();
  const navigation = useNavigation();
  // `canGoBack` also counts parent navigators; the native item needs a screen below in this stack.
  if (!isRealLiquidGlassAvailable() || (navigation.getState()?.index ?? 0) > 0) return null;
  return (
    <Stack.Toolbar placement="left">
      <Stack.Toolbar.Button
        accessibilityLabel={t("back")}
        icon="chevron.left"
        onPress={() => safeBack(router, fallback)}
      />
    </Stack.Toolbar>
  );
}
