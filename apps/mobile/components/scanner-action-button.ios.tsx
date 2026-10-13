import { Button, Host, Label } from "@expo/ui/swift-ui";
import { buttonStyle, controlSize, disabled, frame } from "@expo/ui/swift-ui/modifiers";
import { Platform } from "react-native";
import type { ScannerActionButtonProps } from "./scanner-action-button";

export function ScannerActionButton({
  label,
  icon,
  onPress,
  disabled: isDisabled = false,
  primary = false,
  testID,
}: ScannerActionButtonProps) {
  const glass = Number.parseInt(String(Platform.Version), 10) >= 26;
  return (
    <Host
      colorScheme="dark"
      style={{ minHeight: 56, width: "100%" }}
      matchContents={{ vertical: true }}
    >
      <Button
        onPress={onPress}
        testID={testID}
        modifiers={[
          buttonStyle(
            glass
              ? primary
                ? "glassProminent"
                : "glass"
              : primary
                ? "borderedProminent"
                : "bordered",
          ),
          controlSize("large"),
          disabled(isDisabled),
        ]}
      >
        <Label
          title={label}
          systemImage={icon}
          modifiers={[frame({ maxWidth: Infinity, minHeight: 28 })]}
        />
      </Button>
    </Host>
  );
}
