import { Pressable, Text, View } from "react-native";

import { colors } from "@/theme/colors";

export interface SegmentedControlProps {
  values: string[];
  selectedIndex: number;
  onChange: (index: number) => void;
  label: string;
}

/** Cross-platform fallback; iOS resolves segmented-control.ios.tsx instead. */
export function SegmentedControl({
  values,
  selectedIndex,
  onChange,
  label,
}: SegmentedControlProps) {
  return (
    <View
      accessibilityLabel={label}
      accessibilityRole="tablist"
      style={{
        backgroundColor: colors.elevatedSurface,
        borderCurve: "continuous",
        borderRadius: 9,
        flexDirection: "row",
        gap: 2,
        padding: 2,
      }}
    >
      {values.map((value, index) => {
        const selected = index === selectedIndex;
        return (
          <Pressable
            key={value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(index)}
            style={({ pressed }) => ({
              alignItems: "center",
              backgroundColor: selected ? colors.surface : "transparent",
              borderCurve: "continuous",
              borderRadius: 7,
              boxShadow: selected ? "0 1px 2px rgba(0, 0, 0, 0.14)" : undefined,
              flex: 1,
              justifyContent: "center",
              minHeight: 32,
              opacity: pressed ? 0.65 : 1,
              paddingHorizontal: 8,
            })}
          >
            <Text
              style={{
                color: colors.label,
                fontSize: 13,
                fontWeight: selected ? "600" : "500",
                textAlign: "center",
              }}
            >
              {value}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
