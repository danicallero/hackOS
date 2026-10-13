import { View } from "react-native";
import { ScannerActionButton } from "@/components/scanner-action-button";

export interface ScannerCodeEntryActionsProps {
  cancelLabel: string;
  submitLabel: string;
  disabled: boolean;
  testID: string;
  onCancel: () => void;
  onSubmit: () => void;
}

export function ScannerCodeEntryActions(props: ScannerCodeEntryActionsProps) {
  return (
    <View style={{ flexDirection: "row", gap: 8 }}>
      <View style={{ flex: 1 }}>
        <ScannerActionButton size="regular" label={props.cancelLabel} onPress={props.onCancel} />
      </View>
      <View style={{ flex: 1 }}>
        <ScannerActionButton
          size="regular"
          primary
          testID={props.testID}
          disabled={props.disabled}
          label={props.submitLabel}
          onPress={props.onSubmit}
        />
      </View>
    </View>
  );
}
