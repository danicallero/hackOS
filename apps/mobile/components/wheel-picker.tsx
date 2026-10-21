import { useEffect, useRef } from "react";
import { ScrollView, Text, View } from "react-native";
import { colors, radius, type } from "@/theme";

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
  const settled = useRef(selectedIndex);

  // Follow external changes (a clamped min/max, a month with fewer days).
  useEffect(() => {
    if (settled.current === selectedIndex) return;
    settled.current = selectedIndex;
    scroll.current?.scrollTo({ y: selectedIndex * WHEEL_ITEM_HEIGHT, animated: true });
  }, [selectedIndex]);

  return (
    <View
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="adjustable"
      accessibilityValue={{ text: options[selectedIndex]?.label }}
      style={{ flex, height: WHEEL_ITEM_HEIGHT * VISIBLE_ROWS }}
    >
      <View
        pointerEvents="none"
        style={{
          backgroundColor: colors.elevatedSurface,
          borderCurve: "continuous",
          borderRadius: radius.chip,
          height: WHEEL_ITEM_HEIGHT,
          left: 0,
          position: "absolute",
          right: 0,
          top: WHEEL_ITEM_HEIGHT * 2,
        }}
      />
      <ScrollView
        ref={scroll}
        contentContainerStyle={{ paddingVertical: WHEEL_ITEM_HEIGHT * 2 }}
        contentOffset={{ x: 0, y: selectedIndex * WHEEL_ITEM_HEIGHT }}
        decelerationRate="fast"
        onMomentumScrollEnd={({ nativeEvent }) => {
          const index = Math.min(
            options.length - 1,
            Math.max(0, Math.round(nativeEvent.contentOffset.y / WHEEL_ITEM_HEIGHT)),
          );
          settled.current = index;
          if (index !== selectedIndex) onChange(index);
        }}
        overScrollMode="never"
        showsVerticalScrollIndicator={false}
        snapToInterval={WHEEL_ITEM_HEIGHT}
      >
        {options.map((option, index) => (
          <View
            key={option.value}
            style={{ alignItems: "center", height: WHEEL_ITEM_HEIGHT, justifyContent: "center" }}
          >
            <Text
              numberOfLines={1}
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
