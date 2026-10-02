import { useIsFocused } from "expo-router";
import { useEffect, useRef } from "react";
import { Alert, AppState, Modal, Platform, Pressable, Text, View } from "react-native";
import { SymbolView } from "@/components/symbol";
import { useLocale } from "@/lib/i18n";
import { startNfcRead } from "@/lib/nfc-reader";
import { colors } from "@/theme/colors";

export function NfcReader({
  visible,
  onValue,
  onClose,
}: {
  visible: boolean;
  onValue: (uid: string) => void;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const focused = useIsFocused();
  const callbacks = useRef({ onValue, onClose });
  callbacks.current = { onValue, onClose };
  const message = t("scannerNfcPrompt");
  useEffect(() => {
    if (!visible) return;
    if (!focused) {
      callbacks.current.onClose();
      return;
    }
    let active = true;
    const session = startNfcRead(message);
    const background = AppState.addEventListener("change", (state) => {
      if (state === "background") {
        active = false;
        session.cancel();
        callbacks.current.onClose();
      }
    });
    void session.result
      .then((uid) => {
        if (!active) return;
        if (uid) callbacks.current.onValue(uid);
        callbacks.current.onClose();
      })
      .catch((error: unknown) => {
        if (!active) return;
        const key = error instanceof Error ? error.message : "";
        const errorKey =
          key === "scannerNfcUnavailable" ||
          key === "scannerNfcDisabled" ||
          key === "scannerNfcInvalidTag"
            ? key
            : "scannerNfcError";
        Alert.alert(t("scannerNfcScan"), t(errorKey));
        callbacks.current.onClose();
      });
    return () => {
      active = false;
      background.remove();
      session.cancel();
    };
  }, [visible, focused, message, t]);

  return (
    <Modal
      transparent
      animationType="fade"
      visible={visible && focused && Platform.OS === "android"}
      onRequestClose={onClose}
    >
      <View
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.5)",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <View
          accessibilityViewIsModal
          style={{
            backgroundColor: colors.background,
            borderRadius: 28,
            padding: 24,
            gap: 24,
            alignItems: "center",
          }}
        >
          <SymbolView accessible={false} name="wave.3.right" size={48} tintColor={colors.accent} />
          <Text
            accessibilityRole="header"
            style={{ color: colors.label, fontSize: 22, fontWeight: "700" }}
          >
            {t("scannerNfcScan")}
          </Text>
          <Text style={{ color: colors.secondaryLabel, fontSize: 17, textAlign: "center" }}>
            {message}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            style={{ minHeight: 48, justifyContent: "center", alignSelf: "stretch" }}
          >
            <Text style={{ color: colors.accent, fontSize: 17, textAlign: "center" }}>
              {t("cancel")}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
