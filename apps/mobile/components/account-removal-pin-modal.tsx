import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Text, TextInput, View } from "react-native";

import { ActionButton } from "@/components/native-ui";
import { useLocale } from "@/lib/i18n";
import { colors } from "@/theme/colors";

export type AccountRemovalPinAction = "delete" | "anonymize";

export function AccountRemovalPinModal({
  action,
  busy = false,
  error,
  staticPin = false,
  onCancel,
  onConfirm,
  visible,
}: {
  action: AccountRemovalPinAction | null;
  busy?: boolean;
  error?: string | null;
  staticPin?: boolean;
  onCancel: () => void;
  onConfirm: (pin: string) => void;
  visible: boolean;
}) {
  const { t } = useLocale();
  const [pin, setPin] = useState("");

  useEffect(() => {
    if (!visible) setPin("");
  }, [visible]);

  function updatePin(value: string) {
    setPin(value.replace(/\D/g, "").slice(0, 6));
  }

  function confirm() {
    if (pin.length === 6 && !busy) onConfirm(pin);
  }

  return (
    <Modal
      animationType="fade"
      onRequestClose={onCancel}
      statusBarTranslucent
      transparent
      visible={visible && action !== null}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{
          backgroundColor: "rgba(0, 0, 0, 0.45)",
          flex: 1,
          justifyContent: "center",
          padding: 20,
        }}
      >
        <View
          accessibilityViewIsModal
          style={{
            backgroundColor: colors.elevatedSurface,
            borderCurve: "continuous",
            borderRadius: 20,
            elevation: 12,
            gap: 20,
            padding: 22,
            shadowColor: "#000",
            shadowOffset: { height: 8, width: 0 },
            shadowOpacity: 0.2,
            shadowRadius: 20,
          }}
        >
          <View style={{ gap: 8 }}>
            <Text
              accessibilityRole="header"
              style={{ color: colors.label, fontSize: 20, fontWeight: "700" }}
            >
              {t("accountRemovalPinLabel")}
            </Text>
            <Text style={{ color: colors.secondaryLabel, fontSize: 15, lineHeight: 21 }}>
              {staticPin
                ? t("accountRemovalPinStaticDescription")
                : t("accountRemovalPinDescription")}
            </Text>
          </View>

          <View style={{ gap: 8 }}>
            <Text
              nativeID="account-removal-pin-label"
              style={{ color: colors.label, fontSize: 14, fontWeight: "600" }}
            >
              {t("accountRemovalPinLabel")}
            </Text>
            <TextInput
              accessibilityLabel={t("accountRemovalPinLabel")}
              accessibilityState={{ busy, disabled: busy }}
              autoComplete="sms-otp"
              autoFocus
              editable={!busy}
              keyboardType="number-pad"
              maxLength={6}
              onChangeText={updatePin}
              onSubmitEditing={confirm}
              placeholder="000000"
              placeholderTextColor={colors.tertiaryLabel}
              returnKeyType="done"
              selectionColor={colors.accent}
              style={{
                borderColor: error ? colors.destructive : colors.separator,
                borderRadius: 10,
                borderWidth: 1,
                color: colors.label,
                fontSize: 24,
                letterSpacing: 8,
                minHeight: 52,
                paddingHorizontal: 16,
                textAlign: "center",
              }}
              textContentType="oneTimeCode"
              value={pin}
            />
            {error ? (
              <Text
                accessibilityLiveRegion="assertive"
                accessibilityRole="alert"
                style={{ color: colors.destructive, fontSize: 14, lineHeight: 19 }}
              >
                {error}
              </Text>
            ) : null}
          </View>

          <View style={{ gap: 4 }}>
            <ActionButton disabled={busy} label={t("cancel")} onPress={onCancel} />
            <ActionButton
              busy={busy}
              disabled={pin.length !== 6}
              destructive
              label={action === "delete" ? t("accountDeleteAction") : t("accountAnonymizeAction")}
              onPress={confirm}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
