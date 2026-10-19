import { useRouter } from "expo-router";
import Stack from "expo-router/stack";
import type { ReactNode } from "react";
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
 * Back as a symbol toolbar item, the form the system can move into a vertical
 * bar on a foldable iPhone (the custom `HeaderBackButton` cannot be moved). The
 * screen's Stack hides its own back item (`headerBackVisible: false`) so this
 * is the only one, whatever the screen's position in its stack.
 */
export function EntryBackToolbar({
  fallback,
  children,
}: {
  fallback: Parameters<typeof safeBack>[1];
  /** Extra left-group items (a title): a second left toolbar would replace this one. */
  children?: ReactNode;
}) {
  const { t } = useLocale();
  const router = useRouter();
  if (!isRealLiquidGlassAvailable()) return null;
  return (
    <Stack.Toolbar placement="left">
      <Stack.Toolbar.Button
        accessibilityLabel={t("back")}
        icon="chevron.left"
        onPress={() => safeBack(router, fallback)}
      />
      {children}
    </Stack.Toolbar>
  );
}
