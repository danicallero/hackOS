import type { SFSymbol } from "expo-symbols";
import { Pressable, Text, View } from "react-native";
import { GlassView } from "@/components/glass-view";
import { SymbolView } from "@/components/symbol";
import { colors } from "@/theme/colors";

export interface ScannerActionButtonProps {
  label: string;
  icon: SFSymbol;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
  testID?: string;
}

export function ScannerActionButton({
  label,
  icon,
  onPress,
  disabled = false,
  primary = false,
  testID,
}: ScannerActionButtonProps) {
  return (
    <GlassView
      colorScheme="dark"
      isInteractive
      glassEffectStyle="regular"
      style={{
        borderRadius: 28,
        overflow: "hidden",
        backgroundColor: primary ? colors.accent : undefined,
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
          minHeight: 56,
          paddingHorizontal: 20,
          paddingVertical: 14,
          opacity: disabled ? 0.45 : pressed ? 0.7 : 1,
        })}
      >
        <View
          style={{ flexDirection: "row", gap: 10, alignItems: "center", justifyContent: "center" }}
        >
          <SymbolView accessible={false} name={icon} tintColor="white" size={20} />
          <Text
            style={{
              color: "white",
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
