import { UI_TEST_IDS } from "@hackos/shared/ui-test-ids";
import { useEffect, useRef, useState } from "react";
import { Keyboard, Modal, Platform, Pressable, Text, TextInput, View } from "react-native";
import { GlassView } from "@/components/glass-view";
import { ActionButton } from "@/components/native-ui";
import { useLocale } from "@/lib/i18n";
import { useRouterTabBarBottomInset } from "@/lib/router-tabs-inset";
import { colors } from "@/theme/colors";

/**
 * H22–H26: shared manual entry for camera scans and badge assignment/replacement.
 * The dark glass card belongs over the camera; `appearance="system"` follows
 * the light/dark page it opens from (the event diary, #935).
 */
export function ScannerCodeEntry({
  visible,
  onValue,
  onClose,
  submitLabel,
  title,
  placeholder,
  appearance = "dark",
}: {
  visible: boolean;
  onValue: (value: string) => void;
  onClose: () => void;
  submitLabel?: string;
  /** Defaults to the badge wording; the diary also accepts stand codes. */
  title?: string;
  /** `null` leaves the field empty when the title already names it. */
  placeholder?: string | null;
  appearance?: "dark" | "system";
}) {
  const { t } = useLocale();
  const system = appearance === "system";
  const heading = title ?? t("scannerManualEntryTitle");
  const hint = placeholder === undefined ? t("scannerManualEntryPlaceholder") : placeholder;
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
    if (!visible || Platform.OS !== "ios") return;
    const show = Keyboard.addListener("keyboardWillShow", (event) =>
      setKeyboardHeight(event.endCoordinates.height),
    );
    const hide = Keyboard.addListener("keyboardWillHide", () => setKeyboardHeight(0));
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
    borderRadius: 28,
    maxWidth: 390,
    overflow: "hidden" as const,
    width: "100%" as const,
  };
  const body = (
    <View accessibilityViewIsModal style={{ padding: 20, gap: 14 }}>
      <Text
        accessibilityRole="header"
        style={{ color: system ? colors.label : "white", fontSize: 18, fontWeight: "700" }}
      >
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
        placeholderTextColor={system ? colors.tertiaryLabel : "rgba(255,255,255,0.5)"}
        returnKeyType="done"
        style={{
          backgroundColor: system ? colors.surface : "rgba(255,255,255,0.12)",
          borderCurve: "continuous",
          borderRadius: 12,
          color: system ? colors.label : "white",
          fontSize: 17,
          padding: 14,
        }}
      />
      <ActionButton
        testID={UI_TEST_IDS.scanner.manualSubmit}
        variant="filled"
        disabled={!code.trim()}
        label={submitLabel ?? t("scannerManualEntrySubmit")}
        onPress={submit}
      />
      <ActionButton label={t("cancel")} onPress={onClose} />
    </View>
  );
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <Pressable
        accessibilityLabel={t("close")}
        accessibilityRole="button"
        onPress={onClose}
        style={{ backgroundColor: "rgba(0,0,0,0.4)", position: "absolute", inset: 0 }}
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
        {system ? (
          // Same opaque card as the diary's note editor.
          <View style={[cardStyle, { backgroundColor: colors.background }]}>{body}</View>
        ) : (
          <GlassView colorScheme="dark" glassEffectStyle="regular" style={cardStyle}>
            {body}
          </GlassView>
        )}
      </View>
    </Modal>
  );
}
