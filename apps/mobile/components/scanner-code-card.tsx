import { UI_TEST_IDS } from "@hackos/shared/ui-test-ids";
import { useEffect, useRef, useState } from "react";
import { Keyboard, Modal, Platform, Pressable, Text, TextInput, View } from "react-native";
import { useDialogCardColors } from "@/components/native-ui";
import { ScannerCodeEntryActions } from "@/components/scanner-code-entry-actions";
import { useLocale } from "@/lib/i18n";
import { useRouterTabBarBottomInset } from "@/lib/router-tabs-inset";
import { colors, radius, type } from "@/theme";

/**
 * H22–H26: manual entry card for Android and web, where there is no system text
 * prompt. iOS uses UIKit's own alert (`scanner-code-entry.ios.tsx`) (#935).
 */
export function ScannerCodeCard({
  visible,
  onValue,
  onClose,
  submitLabel,
  title,
  placeholder,
}: {
  visible: boolean;
  onValue: (value: string) => void;
  onClose: () => void;
  submitLabel?: string;
  /** Defaults to the badge wording; the diary also accepts stand codes. */
  title?: string;
  /** `null` leaves the field empty when the title already names it. */
  placeholder?: string | null;
}) {
  const { t } = useLocale();
  const fill = useDialogCardColors();
  const heading = title ?? t("scannerManualEntryTitle");
  const hint = placeholder ?? null;
  const bottomInset = useRouterTabBarBottomInset();
  const [code, setCode] = useState("");
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const submitted = useRef(false);
  useEffect(() => {
    if (!visible) {
      setCode("");
      submitted.current = false;
      setKeyboardHeight(0);
    }
  }, [visible]);
  useEffect(() => {
    if (!visible) return;
    // Android draws edge-to-edge, so the modal is never resized for a docked
    // keyboard; it only reports the "did" events (#935).
    const ios = Platform.OS === "ios";
    const show = Keyboard.addListener(ios ? "keyboardWillShow" : "keyboardDidShow", (event) =>
      setKeyboardHeight(event.endCoordinates.height),
    );
    const hide = Keyboard.addListener(ios ? "keyboardWillHide" : "keyboardDidHide", () =>
      setKeyboardHeight(0),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, [visible]);
  function submit() {
    const value = code.trim();
    if (!value || submitted.current) return;
    submitted.current = true;
    onValue(value);
    onClose();
  }
  const cardStyle = {
    borderCurve: "continuous" as const,
    // H22–H26: 16-point field curves plus the 16-point content inset.
    borderRadius: radius.sheet,
    maxWidth: 390,
    overflow: "hidden" as const,
    width: "100%" as const,
  };
  const body = (
    <View accessibilityViewIsModal style={{ padding: 16, gap: 16 }}>
      <Text accessibilityRole="header" style={[type.headline, { color: colors.label }]}>
        {heading}
      </Text>
      <TextInput
        testID={UI_TEST_IDS.scanner.manualCode}
        accessibilityLabel={heading}
        autoCapitalize="characters"
        autoCorrect={false}
        autoFocus
        value={code}
        onChangeText={setCode}
        onSubmitEditing={submit}
        placeholder={hint ?? undefined}
        placeholderTextColor={colors.tertiaryLabel}
        returnKeyType="done"
        style={{
          backgroundColor: fill.field,
          borderCurve: "continuous",
          borderRadius: radius.control,
          color: colors.label,
          ...type.body,
          minHeight: 48,
          paddingHorizontal: 16,
          paddingVertical: 12,
        }}
      />
      <ScannerCodeEntryActions
        cancelLabel={t("cancel")}
        submitLabel={submitLabel ?? t("scannerRegister")}
        disabled={!code.trim()}
        testID={UI_TEST_IDS.scanner.manualSubmit}
        onCancel={onClose}
        onSubmit={submit}
      />
    </View>
  );
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <Pressable
        accessibilityLabel={t("close")}
        accessibilityRole="button"
        onPress={onClose}
        style={{ backgroundColor: colors.scrim, position: "absolute", inset: 0 }}
      />
      <View
        pointerEvents="box-none"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          paddingHorizontal: 20,
          alignItems: "center",
          bottom: keyboardHeight > 0 ? keyboardHeight + 24 : bottomInset + 40,
        }}
      >
        <View style={[cardStyle, { backgroundColor: fill.card }]}>{body}</View>
      </View>
    </Modal>
  );
}
