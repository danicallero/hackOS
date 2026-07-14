import { SymbolView } from "expo-symbols";
import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useColorScheme,
  View,
} from "react-native";

import { signIn } from "@/lib/auth-client";
import { useLocale } from "@/lib/i18n";
import { colors } from "@/theme/colors";

export default function SignInScreen() {
  useColorScheme();
  const { t } = useLocale();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(false);

  async function onSubmit() {
    setSubmitting(true);
    setError(false);
    const { error: signInError } = await signIn.email({ email: email.trim(), password });
    setSubmitting(false);
    if (signInError) setError(true);
  }

  const disabled = submitting || !email.trim() || !password;

  return (
    <KeyboardAvoidingView
      style={{ backgroundColor: colors.background, flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 24 }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ gap: 28 }}>
          <View style={{ alignItems: "center", gap: 12 }}>
            <View
              style={{
                alignItems: "center",
                backgroundColor: colors.accent,
                borderCurve: "continuous",
                borderRadius: 22,
                height: 76,
                justifyContent: "center",
                width: 76,
              }}
            >
              <SymbolView
                name="sparkles"
                tintColor={colors.accentText}
                size={34}
                accessible={false}
              />
            </View>
            <View style={{ alignItems: "center", gap: 5 }}>
              <Text selectable style={{ color: colors.label, fontSize: 30, fontWeight: "800" }}>
                hackOS
              </Text>
              <Text
                selectable
                style={{ color: colors.secondaryLabel, fontSize: 16, textAlign: "center" }}
              >
                {t("signInSubtitle")}
              </Text>
            </View>
          </View>

          <View
            style={{
              backgroundColor: colors.surface,
              borderCurve: "continuous",
              borderRadius: 16,
              overflow: "hidden",
            }}
          >
            <TextInput
              accessibilityLabel={t("emailLabel")}
              style={{ color: colors.label, fontSize: 17, minHeight: 54, paddingHorizontal: 16 }}
              placeholder={t("emailLabel")}
              placeholderTextColor={colors.tertiaryLabel}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              returnKeyType="next"
              value={email}
              onChangeText={setEmail}
            />
            <View style={{ backgroundColor: colors.separator, height: 0.5, marginLeft: 16 }} />
            <TextInput
              accessibilityLabel={t("passwordLabel")}
              style={{ color: colors.label, fontSize: 17, minHeight: 54, paddingHorizontal: 16 }}
              placeholder={t("passwordLabel")}
              placeholderTextColor={colors.tertiaryLabel}
              secureTextEntry
              autoComplete="password"
              returnKeyType="go"
              enablesReturnKeyAutomatically
              value={password}
              onChangeText={setPassword}
              onSubmitEditing={() => {
                if (!disabled) void onSubmit();
              }}
            />
          </View>

          {error ? (
            <Text
              selectable
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
              style={{
                color: colors.destructive,
                fontSize: 14,
                lineHeight: 20,
                textAlign: "center",
              }}
            >
              {t("signInError")}
            </Text>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled, busy: submitting }}
            style={({ pressed }) => ({
              alignItems: "center",
              backgroundColor: colors.accent,
              borderCurve: "continuous",
              borderRadius: 14,
              justifyContent: "center",
              minHeight: 52,
              opacity: disabled ? 0.45 : pressed ? 0.75 : 1,
            })}
            onPress={() => void onSubmit()}
            disabled={disabled}
          >
            {submitting ? (
              <ActivityIndicator color={colors.accentText} />
            ) : (
              <Text style={{ color: colors.accentText, fontSize: 17, fontWeight: "700" }}>
                {t("signInButton")}
              </Text>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
