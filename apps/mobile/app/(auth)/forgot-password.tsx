import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { AuthAlert, AuthButton, AuthField, AuthHeader, AuthScreen } from "@/components/auth-ui";
import { authClient } from "@/lib/auth-client";
import { useLocale } from "@/lib/i18n";
import { colors } from "@/theme/colors";

const RESET_DEEP_LINK = "hackos://reset-password";

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string }>();
  const { t } = useLocale();
  const [email, setEmail] = useState(typeof params.email === "string" ? params.email : "");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit() {
    if (!email.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await authClient.requestPasswordReset({
        email: email.trim(),
        redirectTo: RESET_DEEP_LINK,
      });
      if (result.error) setError(t("couldNotSendResetEmail"));
      else setSent(true);
    } catch {
      setError(t("couldNotSendResetEmail"));
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <AuthScreen>
        <AuthHeader
          icon="envelope.badge.fill"
          title={t("checkEmail")}
          description={t("resetEmailSent")}
        />
        <AuthButton label={t("backToSignIn")} onPress={() => router.back()} />
      </AuthScreen>
    );
  }

  return (
    <AuthScreen>
      <AuthHeader
        icon="key.fill"
        title={t("resetPassword")}
        description={t("resetPasswordDescription")}
      />
      <View style={{ gap: 18 }}>
        {error ? <AuthAlert message={error} /> : null}
        <AuthField
          label={t("emailLabel")}
          placeholder={t("emailPlaceholder")}
          autoCapitalize="none"
          autoComplete="email"
          autoCorrect={false}
          importantForAutofill="yes"
          keyboardType="email-address"
          returnKeyType="send"
          spellCheck={false}
          textContentType="emailAddress"
          value={email}
          onChangeText={setEmail}
          onSubmitEditing={() => void onSubmit()}
        />
        <AuthButton
          label={t("sendResetLink")}
          busy={submitting}
          disabled={!email.trim()}
          onPress={() => void onSubmit()}
        />
        <Pressable
          accessibilityRole="link"
          onPress={() => router.back()}
          style={({ pressed }) => ({ alignSelf: "center", opacity: pressed ? 0.6 : 1 })}
        >
          <Text style={{ color: colors.accent, fontSize: 15 }}>{t("backToSignIn")}</Text>
        </Pressable>
      </View>
    </AuthScreen>
  );
}
