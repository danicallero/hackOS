import type { SFSymbol } from "expo-symbols";
import { Pressable, Text, useWindowDimensions, View } from "react-native";
import { GlassView } from "@/components/glass-view";
import { SymbolView } from "@/components/symbol";
import { colors } from "@/theme/colors";
import { isAccessibilityTextSize } from "@/theme/dynamic-type";
import { type } from "@/theme/tokens";

export interface ScannerActionButtonProps {
  label: string;
  icon?: SFSymbol;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
  /** `compact`: icon over a one-line label, three of them side by side in a short pane. */
  size?: "regular" | "large" | "compact";
  testID?: string;
}

export function ScannerActionButton({
  label,
  icon,
  onPress,
  disabled = false,
  primary = false,
  size = "large",
  testID,
}: ScannerActionButtonProps) {
  const accessibilityText = isAccessibilityTextSize(useWindowDimensions().fontScale);
  return (
    <GlassView
      colorScheme="auto"
      isInteractive
      glassEffectStyle="regular"
      style={{
        borderRadius: size === "regular" ? 24 : size === "compact" ? 20 : 28,
        overflow: "hidden",
        backgroundColor: primary ? colors.primaryAction : undefined,
      }}
    >
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => ({
          minHeight: size === "regular" ? 48 : 56,
          paddingHorizontal: size === "compact" ? 6 : 20,
          paddingVertical: size === "regular" ? 10 : size === "compact" ? 6 : 14,
          justifyContent: "center",
          opacity: disabled ? 0.45 : pressed ? 0.7 : 1,
        })}
      >
        <View
          style={{
            flexDirection: size === "compact" ? "column" : "row",
            gap: size === "compact" ? 2 : 10,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {icon ? (
            <SymbolView
              accessible={false}
              name={icon}
              tintColor={primary ? colors.primaryActionText : colors.label}
              size={20}
            />
          ) : null}
          <Text
            adjustsFontSizeToFit={size === "compact" && !accessibilityText}
            minimumFontScale={size === "compact" ? 0.75 : undefined}
            numberOfLines={size === "compact" && !accessibilityText ? 1 : undefined}
            style={{
              color: primary ? colors.primaryActionText : colors.label,
              fontSize: size === "compact" ? type.footnote.fontSize : type.body.fontSize,
              fontWeight: "600",
              flexShrink: 1,
              textAlign: "center",
            }}
          >
            {label}
          </Text>
        </View>
      </Pressable>
    </GlassView>
  );
}
