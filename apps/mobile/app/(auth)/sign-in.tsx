import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Platform, Pressable, Text, type TextInput, View } from "react-native";

import { AuthAlert, AuthButton, AuthField, AuthHeader, AuthScreen } from "@/components/auth-ui";
import { apiFetch } from "@/lib/api";
import { signIn } from "@/lib/auth-client";
import { EVENT_WEBSITE_DISPLAY } from "@/lib/env";
import { useLocale } from "@/lib/i18n";
import type { PublicEvent } from "@/lib/types";
import { colors } from "@/theme/colors";

// React Native recommends choosing one autofill API per platform. Combining
// autoComplete and textContentType can make iOS credential-provider fills
// unreliable, especially when both fields are populated in one operation.
const usernameAutofillProps = Platform.select({
  ios: { textContentType: "username" as const },
  android: { autoComplete: "username" as const, importantForAutofill: "yes" as const },
  default: { autoComplete: "username" as const },
});

const passwordAutofillProps = Platform.select({
  ios: { textContentType: "password" as const },
  android: { autoComplete: "current-password" as const, importantForAutofill: "yes" as const },
  default: { autoComplete: "current-password" as const },
});

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
            {...usernameAutofillProps}
            label={t("emailLabel")}
            placeholder={t("emailPlaceholder")}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            returnKeyType="next"
            spellCheck={false}
            onChangeText={setEmail}
            onEndEditing={({ nativeEvent }) => setEmail(nativeEvent.text)}
            onSubmitEditing={() => passwordRef.current?.focus()}
          />
          <AuthField
            {...passwordAutofillProps}
            inputRef={passwordRef}
            label={t("passwordLabel")}
            placeholder={t("passwordPlaceholder")}
            autoCapitalize="none"
            autoCorrect={false}
            enablesReturnKeyAutomatically
            returnKeyType="go"
            secureTextEntry
            spellCheck={false}
            onChangeText={setPassword}
            onEndEditing={({ nativeEvent }) => setPassword(nativeEvent.text)}
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
