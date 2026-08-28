import { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import { ActionButton } from "@/components/native-ui";
import { useLocale } from "@/lib/i18n";
import { colors } from "@/theme/colors";

export type AccountRemovalPinAction = "delete" | "anonymize";

export function AccountRemovalPinModal({
  action,
  busy = false,
  error,
  passwordMode = false,
  staticPin = false,
  onCancel,
  onConfirm,
  visible,
}: {
  action: AccountRemovalPinAction | null;
  busy?: boolean;
  error?: string | null;
  passwordMode?: boolean;
  staticPin?: boolean;
  onCancel: () => void;
  onConfirm: (credential: string) => void;
  visible: boolean;
}) {
  const { t } = useLocale();
  const [credential, setCredential] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      setCredential("");
      setLocalError(null);
    }
  }, [visible]);

  function updateCredential(value: string) {
    setCredential(passwordMode ? value.slice(0, 128) : value.replace(/\D/g, "").slice(0, 6));
    setLocalError(null);
  }

  function confirm() {
    if (busy) return;
    if (passwordMode && credential.length === 0) {
      setLocalError(t("accountRemovalPasswordRequired"));
      return;
    }
    if (!passwordMode && credential.length !== 6) return;
    onConfirm(credential);
  }

  const displayedError = error ?? localError;

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
        }}
      >
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: "center",
            padding: 20,
          }}
          keyboardShouldPersistTaps="handled"
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
                {passwordMode ? t("accountRemovalPasswordTitle") : t("accountRemovalPinLabel")}
              </Text>
              <Text style={{ color: colors.secondaryLabel, fontSize: 15 }}>
                {passwordMode
                  ? t("accountRemovalPasswordDescription")
                  : staticPin
                    ? t("accountRemovalPinStaticDescription")
                    : t("accountRemovalPinDescription")}
              </Text>
            </View>

            <View style={{ gap: 8 }}>
              <Text
                nativeID="account-removal-pin-label"
                style={{ color: colors.label, fontSize: 14, fontWeight: "600" }}
              >
                {passwordMode ? t("accountRemovalPasswordLabel") : t("accountRemovalPinLabel")}
              </Text>
              <TextInput
                accessibilityLabel={
                  passwordMode ? t("accountRemovalPasswordLabel") : t("accountRemovalPinLabel")
                }
                accessibilityHint={displayedError ?? undefined}
                accessibilityState={{ busy, disabled: busy }}
                autoCapitalize={passwordMode ? "none" : undefined}
                autoComplete={passwordMode ? "password" : "sms-otp"}
                autoFocus
                autoCorrect={passwordMode ? false : undefined}
                editable={!busy}
                keyboardType={passwordMode ? "default" : "number-pad"}
                maxLength={passwordMode ? 128 : 6}
                onChangeText={updateCredential}
                onSubmitEditing={confirm}
                placeholder={passwordMode ? undefined : "000000"}
                placeholderTextColor={colors.tertiaryLabel}
                returnKeyType="done"
                selectionColor={colors.accent}
                style={{
                  borderColor: displayedError ? colors.destructive : colors.separator,
                  borderRadius: 10,
                  borderWidth: 1,
                  color: colors.label,
                  fontSize: passwordMode ? 17 : 24,
                  letterSpacing: passwordMode ? 0 : 8,
                  minHeight: 52,
                  paddingHorizontal: 16,
                  textAlign: passwordMode ? "left" : "center",
                }}
                secureTextEntry={passwordMode}
                textContentType={passwordMode ? "password" : "oneTimeCode"}
                value={credential}
              />
              {displayedError ? (
                <Text
                  accessibilityLiveRegion="assertive"
                  accessibilityRole="alert"
                  style={{ color: colors.destructive, fontSize: 14 }}
                >
                  {displayedError}
                </Text>
              ) : null}
            </View>

            <View style={{ gap: 4 }}>
              <ActionButton disabled={busy} label={t("cancel")} onPress={onCancel} />
              <ActionButton
                busy={busy}
                disabled={!passwordMode && credential.length !== 6}
                destructive
                label={action === "delete" ? t("accountDeleteAction") : t("accountAnonymizeAction")}
                onPress={confirm}
              />
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}
