import { useLocalSearchParams, useRouter } from "expo-router";
import { useRef, useState } from "react";
import { Pressable, Text, type TextInput, useWindowDimensions, View } from "react-native";

import { AuthAlert, AuthButton, AuthField, AuthHeader, AuthScreen } from "@/components/auth-ui";
import { authClient } from "@/lib/auth-client";
import { useLocale } from "@/lib/i18n";
import { colors } from "@/theme/colors";

export default function ResetPasswordScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string; error?: string }>();
  const { t } = useLocale();
  const { fontScale } = useWindowDimensions();
  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);
  const token = typeof params.token === "string" ? params.token : null;
  const invalidLink = !token || params.error === "INVALID_TOKEN";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [updated, setUpdated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);

  const passwordError = attempted && password.length < 8 ? t("passwordTooShort") : null;
  const confirmError = attempted && confirm !== password ? t("passwordsDontMatch") : null;

  async function onSubmit() {
    if (submitting || invalidLink || !token) return;
    setAttempted(true);
    if (password.length < 8) {
      passwordRef.current?.focus();
      return;
    }
    if (confirm !== password) {
      confirmRef.current?.focus();
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await authClient.resetPassword({ newPassword: password, token });
      if (result.error) setError(t("resetLinkInvalid"));
      else setUpdated(true);
    } catch {
      setError(t("resetLinkInvalid"));
    } finally {
      setSubmitting(false);
    }
  }

  if (updated) {
    return (
      <AuthScreen scrollable={fontScale > 1.3}>
        <AuthHeader
          align="leading"
          context="hackOS"
          title={t("passwordUpdatedTitle")}
          description={t("passwordUpdated")}
        />
        <AuthButton label={t("backToSignIn")} onPress={() => router.replace("/(auth)/sign-in")} />
      </AuthScreen>
    );
  }

  return (
    <AuthScreen
      scrollable={fontScale > 1.3}
      footer={
        <Pressable
          accessibilityRole="link"
          onPress={() => router.replace("/(auth)/sign-in")}
          style={({ pressed }) => ({
            alignItems: "center",
            justifyContent: "center",
            minHeight: 44,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Text style={{ color: colors.interactiveText, fontSize: 15, fontWeight: "600" }}>
            {t("backToSignIn")}
          </Text>
        </Pressable>
      }
    >
      <AuthHeader
        align="leading"
        context="hackOS"
        title={t("setNewPassword")}
        description={t("newPasswordDescription")}
      />
      <View style={{ gap: 18 }}>
        {invalidLink ? <AuthAlert message={t("resetTokenMissing")} /> : null}
        {error ? <AuthAlert message={error} /> : null}
        {!invalidLink ? (
          <>
            <AuthField
              inputRef={passwordRef}
              label={t("newPassword")}
              placeholder={t("passwordPlaceholder")}
              error={passwordError}
              autoCapitalize="none"
              autoComplete="new-password"
              autoCorrect={false}
              importantForAutofill="yes"
              returnKeyType="next"
              secureTextEntry
              showPasswordLabel={t("showPassword")}
              hidePasswordLabel={t("hidePassword")}
              spellCheck={false}
              textContentType="newPassword"
              value={password}
              onChangeText={setPassword}
              onSubmitEditing={() => confirmRef.current?.focus()}
            />
            <AuthField
              inputRef={confirmRef}
              label={t("confirmPassword")}
              placeholder={t("passwordPlaceholder")}
              error={confirmError}
              autoCapitalize="none"
              autoComplete="new-password"
              autoCorrect={false}
              enablesReturnKeyAutomatically
              importantForAutofill="yes"
              returnKeyType="done"
              secureTextEntry
              showPasswordLabel={t("showPassword")}
              hidePasswordLabel={t("hidePassword")}
              spellCheck={false}
              textContentType="newPassword"
              value={confirm}
              onChangeText={setConfirm}
              onSubmitEditing={() => void onSubmit()}
            />
            <AuthButton
              label={t("updatePassword")}
              busy={submitting}
              disabled={submitting}
              onPress={() => void onSubmit()}
            />
          </>
        ) : (
          <AuthButton
            label={t("requestAnotherLink")}
            onPress={() => router.replace("/(auth)/forgot-password")}
          />
        )}
      </View>
    </AuthScreen>
  );
}
