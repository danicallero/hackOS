import { useEffect, useRef } from "react";
import { ScrollView, Text, useWindowDimensions, View } from "react-native";
import { colors, isAccessibilityTextSize, radius, space, type } from "@/theme";

export const WHEEL_ITEM_HEIGHT = 36;
const VISIBLE_ROWS = 5;

export interface WheelOption {
  label: string;
  value: number;
}

/**
 * One column of UIKit's picker wheel for Android (H55, H59): snapping rows
 * with a rounded selection band. Replaces the Material date/time dialogs.
 * Controlled by `selectedIndex`; `onChange` fires when a scroll settles.
 */
export function WheelPicker({
  options,
  selectedIndex,
  onChange,
  accessibilityLabel,
  flex = 1,
}: {
  options: WheelOption[];
  selectedIndex: number;
  onChange: (index: number) => void;
  accessibilityLabel: string;
  flex?: number;
}) {
  const scroll = useRef<ScrollView>(null);
  const { fontScale, height } = useWindowDimensions();
  const accessibilityText = isAccessibilityTextSize(fontScale);
  const itemHeight = Math.max(
    WHEEL_ITEM_HEIGHT,
    Math.ceil(type.body.lineHeight * fontScale * (accessibilityText ? 2 : 1) + space.md),
  );

  // Keep the wheel inside the sheet when two-line AX rows grow (#1166).
  const visibleRows = accessibilityText ? (itemHeight * 3 + 100 <= height ? 3 : 1) : VISIBLE_ROWS;
  const edgeRows = (visibleRows - 1) / 2;

  // Follow external changes (a clamped min/max, a month with fewer days).
  useEffect(() => {
    scroll.current?.scrollTo({ y: selectedIndex * itemHeight, animated: true });
  }, [selectedIndex, itemHeight]);

  return (
    <View
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="adjustable"
      accessibilityValue={{ text: options[selectedIndex]?.label }}
      style={{ flex, height: itemHeight * visibleRows }}
    >
      <View
        pointerEvents="none"
        style={{
          backgroundColor: colors.elevatedSurface,
          borderCurve: "continuous",
          borderRadius: radius.chip,
          height: itemHeight,
          left: 0,
          position: "absolute",
          right: 0,
          top: itemHeight * edgeRows,
        }}
      />
      <ScrollView
        ref={scroll}
        contentContainerStyle={{ paddingVertical: itemHeight * edgeRows }}
        contentOffset={{ x: 0, y: selectedIndex * itemHeight }}
        decelerationRate="fast"
        onMomentumScrollEnd={({ nativeEvent }) => {
          const index = Math.min(
            options.length - 1,
            Math.max(0, Math.round(nativeEvent.contentOffset.y / itemHeight)),
          );
          if (index !== selectedIndex) onChange(index);
        }}
        overScrollMode="never"
        showsVerticalScrollIndicator={false}
        snapToInterval={itemHeight}
      >
        {options.map((option, index) => (
          <View
            key={option.value}
            style={{ alignItems: "center", height: itemHeight, justifyContent: "center" }}
          >
            <Text
              numberOfLines={accessibilityText ? 2 : 1}
              style={{
                ...type.body,
                color: index === selectedIndex ? colors.label : colors.secondaryLabel,
              }}
            >
              {option.label}
            </Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
