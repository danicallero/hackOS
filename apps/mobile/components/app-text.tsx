import { Text, type TextProps } from "react-native";
import { colors, type TypeVariant, type } from "@/theme";

type Tone = "primary" | "secondary" | "accent" | "destructive";

// Keys, not values: Android colours resolve against the scheme when read, so a
// module-scope palette would freeze the launch scheme (see theme/colors.ts).
const TONE_KEY = {
  primary: "label",
  secondary: "secondaryLabel",
  accent: "interactiveText",
  destructive: "destructive",
} as const;

/**
 * The app's text. `variant` picks a step of the Apple ramp (`theme/tokens.ts`)
 * and `tone` a semantic label colour, so screens never write a font size.
 * Scales with Dynamic Type; pass `style` last for layout only.
 */
export function AppText({
  variant = "body",
  tone = "primary",
  style,
  ...props
}: TextProps & { variant?: TypeVariant; tone?: Tone }) {
  return <Text {...props} style={[type[variant], { color: colors[TONE_KEY[tone]] }, style]} />;
}
