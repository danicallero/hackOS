import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, type TextInput, View } from "react-native";

import { AuthAlert, AuthButton, AuthField, AuthHeader, AuthScreen } from "@/components/auth-ui";
import { apiFetch } from "@/lib/api";
import { signIn } from "@/lib/auth-client";
import { EVENT_WEBSITE_DISPLAY } from "@/lib/env";
import { useLocale } from "@/lib/i18n";
import type { PublicEvent } from "@/lib/types";
import { colors } from "@/theme/colors";

export default function SignInScreen() {
  const router = useRouter();
  const { t } = useLocale();
  const passwordRef = useRef<TextInput>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [event, setEvent] = useState<PublicEvent | null>(null);

  useEffect(() => {
    let active = true;
    apiFetch<PublicEvent>("/api/public/event")
      .then((value) => {
        if (active) setEvent(value);
      })
      .catch(() => {
        // Event branding is helpful context, but must never block sign-in.
      });
    return () => {
      active = false;
    };
  }, []);

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
    <AuthScreen
      scrollable={false}
      footer={
        <View
          style={{
            borderTopColor: colors.separator,
            borderTopWidth: 1,
            paddingTop: 14,
          }}
        >
          <Text selectable style={{ color: colors.secondaryLabel, fontSize: 13, lineHeight: 18 }}>
            {t("eventAccessNotice", { website: EVENT_WEBSITE_DISPLAY })}
          </Text>
        </View>
      }
    >
      <AuthHeader
        align="leading"
        title={event?.name || "hackOS"}
        description={event?.tagline || t("eventCompanionSubtitle")}
      />

      <View style={{ gap: 16 }}>
        {error ? <AuthAlert message={error} /> : null}
        <View style={{ gap: 14 }}>
          <AuthField
            label={t("emailLabel")}
            placeholder={t("emailPlaceholder")}
            autoCapitalize="none"
            autoComplete="username"
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
        </View>

        <Pressable
          accessibilityRole="link"
          onPress={() =>
            router.push({ pathname: "/(auth)/forgot-password", params: { email: email.trim() } })
          }
          style={({ pressed }) => ({ alignSelf: "flex-start", opacity: pressed ? 0.6 : 1 })}
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
