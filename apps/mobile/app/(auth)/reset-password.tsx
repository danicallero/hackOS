import { useLocalSearchParams, useRouter } from "expo-router";
import { useRef, useState } from "react";
import { type TextInput, View } from "react-native";

import { AuthAlert, AuthButton, AuthField, AuthHeader, AuthScreen } from "@/components/auth-ui";
import { authClient } from "@/lib/auth-client";
import { useLocale } from "@/lib/i18n";

export default function ResetPasswordScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string; error?: string }>();
  const { t } = useLocale();
  const confirmRef = useRef<TextInput>(null);
  const token = typeof params.token === "string" ? params.token : null;
  const invalidLink = !token || params.error === "INVALID_TOKEN";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [updated, setUpdated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const passwordError = password.length > 0 && password.length < 8 ? t("passwordTooShort") : null;
  const confirmError = confirm.length > 0 && confirm !== password ? t("passwordsDontMatch") : null;
  const disabled =
    submitting ||
    invalidLink ||
    password.length < 8 ||
    confirm.length === 0 ||
    confirm !== password;

  async function onSubmit() {
    if (disabled || !token) return;
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
      <AuthScreen>
        <AuthHeader
          icon="checkmark.circle.fill"
          title={t("passwordUpdatedTitle")}
          description={t("passwordUpdated")}
        />
        <AuthButton label={t("backToSignIn")} onPress={() => router.replace("/(auth)/sign-in")} />
      </AuthScreen>
    );
  }

  return (
    <AuthScreen>
      <AuthHeader
        icon="lock.rotation"
        title={t("setNewPassword")}
        description={t("newPasswordDescription")}
      />
      <View style={{ gap: 18 }}>
        {invalidLink ? <AuthAlert message={t("resetTokenMissing")} /> : null}
        {error ? <AuthAlert message={error} /> : null}
        {!invalidLink ? (
          <>
            <AuthField
              label={t("newPassword")}
              placeholder={t("passwordPlaceholder")}
              error={passwordError}
              autoCapitalize="none"
              autoComplete="new-password"
              autoCorrect={false}
              importantForAutofill="yes"
              returnKeyType="next"
              secureTextEntry
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
              spellCheck={false}
              textContentType="newPassword"
              value={confirm}
              onChangeText={setConfirm}
              onSubmitEditing={() => void onSubmit()}
            />
            <AuthButton
              label={t("updatePassword")}
              busy={submitting}
              disabled={disabled}
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
