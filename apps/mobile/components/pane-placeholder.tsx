import { useEffect } from "react";
import { Text, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { SymbolView, type SymbolViewProps } from "@/components/symbol";
import { colors, motion, type } from "@/theme";

/**
 * H22-H26, H55: what an empty detail pane shows where a result will appear, in the system's
 * ContentUnavailableView style: a large symbol, a headline and one secondary line, centred,
 * with no card or border. It is one accessibility element and fades in (Reduce Motion: at once).
 */
export function PanePlaceholder({
  icon,
  title,
  body,
}: {
  icon: SymbolViewProps["name"];
  title: string;
  body: string;
}) {
  const reducedMotion = useReducedMotion();
  const opacity = useSharedValue(reducedMotion ? 1 : 0);
  useEffect(() => {
    opacity.set(withTiming(1, { duration: reducedMotion ? 0 : motion.duration.base }));
  }, [opacity, reducedMotion]);
  const fade = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  return (
    <Animated.View style={[{ flex: 1 }, fade]}>
      <View
        accessible
        accessibilityLabel={`${title}. ${body}`}
        style={{ alignItems: "center", flex: 1, gap: 8, justifyContent: "center", padding: 32 }}
      >
        <SymbolView accessible={false} name={icon} size={48} tintColor={colors.secondaryLabel} />
        <Text style={{ ...type.headline, color: colors.label, textAlign: "center" }}>{title}</Text>
        <Text style={{ ...type.subhead, color: colors.secondaryLabel, textAlign: "center" }}>
          {body}
        </Text>
      </View>
    </Animated.View>
  );
}
