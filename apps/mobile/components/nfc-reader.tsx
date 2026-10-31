import { useIsFocused } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { AppState, Modal, Platform, Pressable, Text, View } from "react-native";
import { SymbolView } from "@/components/symbol";
import { alert } from "@/lib/alert";
import { useLocale } from "@/lib/i18n";
import { startNfcRead } from "@/lib/nfc-reader";
import { colors } from "@/theme/colors";
import { type } from "@/theme/tokens";

export function NfcReader({
  visible,
  claimBadge = false,
  showAndroidOverlay = true,
  continuous = false,
  onValue,
  onClose,
}: {
  visible: boolean;
  claimBadge?: boolean;
  showAndroidOverlay?: boolean;
  continuous?: boolean;
  onValue: (uid: string, info: { claimFailed: boolean }) => void;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const focused = useIsFocused();
  const [readKey, setReadKey] = useState(0);
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
    let repeat: ReturnType<typeof setTimeout> | undefined;
    const session = startNfcRead(message, { claimBadge });
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
        if (uid) callbacks.current.onValue(uid, { claimFailed: session.claimFailed() });
        if (uid && continuous && Platform.OS === "android") {
          repeat = setTimeout(() => {
            if (active) setReadKey(readKey + 1);
          }, 500);
        } else callbacks.current.onClose();
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
        alert(t("scannerNfcScan"), t(errorKey));
        callbacks.current.onClose();
      });
    return () => {
      active = false;
      if (repeat) clearTimeout(repeat);
      background.remove();
      session.cancel();
    };
  }, [visible, focused, claimBadge, message, t, continuous, readKey]);

  return (
    <Modal
      transparent
      animationType="fade"
      visible={visible && focused && showAndroidOverlay && Platform.OS === "android"}
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
            style={{ color: colors.label, fontSize: type.title2.fontSize, fontWeight: "700" }}
          >
            {t("scannerNfcScan")}
          </Text>
          <Text
            style={{
              color: colors.secondaryLabel,
              fontSize: type.body.fontSize,
              textAlign: "center",
            }}
          >
            {message}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            style={{ minHeight: 48, justifyContent: "center", alignSelf: "stretch" }}
          >
            <Text
              style={{ color: colors.accent, fontSize: type.body.fontSize, textAlign: "center" }}
            >
              {t("cancel")}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
