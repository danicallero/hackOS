import type { SFSymbol } from "expo-symbols";
import { Pressable, Text, View } from "react-native";
import { GlassView } from "@/components/glass-view";
import { SymbolView } from "@/components/symbol";
import { colors } from "@/theme/colors";

export interface ScannerActionButtonProps {
  label: string;
  icon?: SFSymbol;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
  size?: "regular" | "large";
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
  return (
    <GlassView
      colorScheme="auto"
      isInteractive
      glassEffectStyle="regular"
      style={{
        borderRadius: size === "regular" ? 24 : 28,
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
          paddingHorizontal: 20,
          paddingVertical: size === "regular" ? 10 : 14,
          opacity: disabled ? 0.45 : pressed ? 0.7 : 1,
        })}
      >
        <View
          style={{ flexDirection: "row", gap: 10, alignItems: "center", justifyContent: "center" }}
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
            style={{
              color: primary ? colors.primaryActionText : colors.label,
              fontSize: 17,
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
