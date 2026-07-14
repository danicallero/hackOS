import { Host, Picker, Text } from "@expo/ui/swift-ui";
import { pickerStyle, tag } from "@expo/ui/swift-ui/modifiers";

import type { SegmentedControlProps } from "./segmented-control";

/** A real SwiftUI segmented Picker. @expo/ui is included in Expo Go. */
export function SegmentedControl({
  values,
  selectedIndex,
  onChange,
  label,
}: SegmentedControlProps) {
  return (
    <Host matchContents>
      <Picker
        label={label}
        modifiers={[pickerStyle("segmented")]}
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
