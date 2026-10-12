import { Platform } from "react-native";
import Svg, { Path } from "react-native-svg";
import { SymbolView } from "@/components/symbol";
import { colors } from "@/theme/colors";

const STAR_PATH =
  "M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z";

/**
 * The favourite star (#935). Android's Material Symbols font only ships the
 * outlined `star` glyph, so on/off were indistinguishable there; Android
 * draws a filled path for "on" and an outline for "off".
 */
export function FavouriteStar({ on, size = 20 }: { on: boolean; size?: number }) {
  if (Platform.OS !== "android") {
    return (
      <SymbolView
        accessible={false}
        name={on ? "star.fill" : "star"}
        size={size}
        tintColor={on ? colors.warning : colors.secondaryLabel}
      />
    );
  }
  return (
    <Svg accessible={false} width={size} height={size} viewBox="0 0 24 24">
      <Path
        d={STAR_PATH}
        fill={on ? (colors.warning as string) : "none"}
        stroke={on ? (colors.warning as string) : (colors.secondaryLabel as string)}
        strokeWidth={on ? 1 : 1.8}
        strokeLinejoin="round"
      />
    </Svg>
  );
}
