import { Button, Host, HStack, Label } from "@expo/ui/swift-ui";
import { buttonStyle, controlSize, disabled, frame } from "@expo/ui/swift-ui/modifiers";
import { useState } from "react";
import { Platform, View } from "react-native";
import type { ScannerCodeEntryActionsProps } from "./scanner-code-entry-actions";

export function ScannerCodeEntryActions(props: ScannerCodeEntryActionsProps) {
  const glass = Number.parseInt(String(Platform.Version), 10) >= 26;
  const [width, setWidth] = useState(0);
  const buttonWidth = (width - 8) / 2;
  return (
    <View style={{ height: 48 }} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      {width > 0 && (
        <Host
          style={{ position: "absolute", width, height: 48 }}
          ignoreSafeArea="all"
          modifiers={[frame({ width, height: 48, alignment: "topLeading" })]}
        >
          <HStack spacing={8} modifiers={[frame({ width, height: 48 })]}>
            <Button
              onPress={props.onCancel}
              modifiers={[buttonStyle(glass ? "glass" : "bordered"), controlSize("regular")]}
            >
              <Label
                title={props.cancelLabel}
                modifiers={[frame({ width: buttonWidth - 32, height: 32 })]}
              />
            </Button>
            <Button
              testID={props.testID}
              onPress={props.onSubmit}
              modifiers={[
                buttonStyle(glass ? "glassProminent" : "borderedProminent"),
                controlSize("regular"),
                disabled(props.disabled),
              ]}
            >
              <Label
                title={props.submitLabel}
                modifiers={[frame({ width: buttonWidth - 32, height: 32 })]}
              />
            </Button>
          </HStack>
        </Host>
      )}
    </View>
  );
}
