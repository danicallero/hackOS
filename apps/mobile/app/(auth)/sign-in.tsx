import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import { Pressable, Text, type TextInput, View } from "react-native";

import { AuthAlert, AuthButton, AuthField, AuthHeader, AuthScreen } from "@/components/auth-ui";
import { signIn } from "@/lib/auth-client";
import { useLocale } from "@/lib/i18n";
import { colors } from "@/theme/colors";

export default function SignInScreen() {
  const router = useRouter();
  const { t } = useLocale();
  const passwordRef = useRef<TextInput>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const disabled = submitting || !email.trim() || !password;

  async function onSubmit() {
    if (disabled) return;
    setSubmitting(true);
    setError(null);
    try {
      const { error: signInError } = await signIn.email({ email: email.trim(), password });
      if (signInError) setError(t("signInError"));
    } catch {
      setError(t("signInError"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthScreen>
      <AuthHeader title={t("welcomeBack")} description={t("signInSubtitle")} />

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
          returnKeyType="next"
          spellCheck={false}
          textContentType="username"
          value={email}
          onChangeText={setEmail}
          onSubmitEditing={() => passwordRef.current?.focus()}
        />
        <AuthField
          inputRef={passwordRef}
          label={t("passwordLabel")}
          placeholder={t("passwordPlaceholder")}
          autoCapitalize="none"
          autoComplete="current-password"
          autoCorrect={false}
          enablesReturnKeyAutomatically
          importantForAutofill="yes"
          returnKeyType="go"
          secureTextEntry
          spellCheck={false}
          textContentType="password"
          value={password}
          onChangeText={setPassword}
          onSubmitEditing={() => void onSubmit()}
        />

        <Pressable
          accessibilityRole="link"
          onPress={() =>
            router.push({ pathname: "/(auth)/forgot-password", params: { email: email.trim() } })
          }
          style={({ pressed }) => ({ alignSelf: "flex-end", opacity: pressed ? 0.6 : 1 })}
        >
          <Text style={{ color: colors.accent, fontSize: 15, fontWeight: "600" }}>
            {t("forgotPassword")}
          </Text>
        </Pressable>

        <AuthButton
          label={t("signInButton")}
          busy={submitting}
          disabled={disabled}
          onPress={() => void onSubmit()}
        />
      </View>
    </AuthScreen>
  );
}
