import { Host, Picker, Text } from "@expo/ui/swift-ui";
import { frame, pickerStyle, tag } from "@expo/ui/swift-ui/modifiers";

import type { SegmentedControlProps } from "./segmented-control";

const HEIGHT = 50;

/** A real SwiftUI segmented Picker. @expo/ui is included in Expo Go. */
export function SegmentedControl({
  values,
  selectedIndex,
  onChange,
  label,
}: SegmentedControlProps) {
  return (
    <Host style={{ height: HEIGHT, width: "100%" }}>
      <Picker
        label={label}
        modifiers={[pickerStyle("segmented"), frame({ height: HEIGHT, maxWidth: Infinity })]}
        selection={selectedIndex}
        onSelectionChange={onChange}
      >
        {values.map((value, index) => (
          <Text key={value} modifiers={[tag(index)]}>
            {value}
          </Text>
        ))}
      </Picker>
    </Host>
  );
}
