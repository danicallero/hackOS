import { useLocalSearchParams, useRouter } from "expo-router";
import { useRef, useState } from "react";
import { Pressable, Text, type TextInput, useWindowDimensions, View } from "react-native";

import { AuthAlert, AuthButton, AuthField, AuthHeader, AuthScreen } from "@/components/auth-ui";
import { authClient } from "@/lib/auth-client";
import { useLocale } from "@/lib/i18n";
import { colors } from "@/theme/colors";

const RESET_DEEP_LINK = "hackos://reset-password";

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string }>();
  const { t } = useLocale();
  const { fontScale } = useWindowDimensions();
  const emailRef = useRef<TextInput>(null);
  const [email, setEmail] = useState(typeof params.email === "string" ? params.email : "");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit() {
    if (submitting) return;
    if (!email.trim()) {
      setEmailError(t("emailRequired"));
      emailRef.current?.focus();
      return;
    }
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
      <AuthScreen scrollable={fontScale > 1.3}>
        <AuthHeader
          align="leading"
          context="hackOS"
          title={t("checkEmail")}
          description={t("resetEmailSent")}
        />
        <AuthButton label={t("backToSignIn")} onPress={() => router.back()} />
      </AuthScreen>
    );
  }

  return (
    <AuthScreen
      scrollable={fontScale > 1.3}
      footer={
        <Pressable
          accessibilityRole="link"
          onPress={() => router.back()}
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
        title={t("resetPassword")}
        description={t("resetPasswordDescription")}
      />
      <View style={{ gap: 18 }}>
        {error ? <AuthAlert message={error} /> : null}
        <AuthField
          inputRef={emailRef}
          label={t("emailLabel")}
          error={emailError}
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
          onChangeText={(value) => {
            setEmail(value);
            if (emailError) setEmailError(null);
          }}
          onSubmitEditing={() => void onSubmit()}
        />
        <AuthButton
          label={t("sendResetLink")}
          busy={submitting}
          disabled={submitting}
          onPress={() => void onSubmit()}
        />
      </View>
    </AuthScreen>
  );
}
