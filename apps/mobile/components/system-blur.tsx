import { BlurView } from "expo-blur";
import type { StyleProp, ViewStyle } from "react-native";
import { useColorScheme } from "react-native";

/** The system's chrome material, the same blur a native bar draws. Fill a parent with it. */
export function SystemBlur({ style }: { style?: StyleProp<ViewStyle> }) {
  const scheme = useColorScheme();
  return (
    <BlurView
      pointerEvents="none"
      intensity={40}
      tint={scheme === "dark" ? "systemChromeMaterialDark" : "systemChromeMaterialLight"}
      style={[{ bottom: 0, left: 0, position: "absolute", right: 0, top: 0 }, style]}
    />
  );
}
