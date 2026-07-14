import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
} from "react-native";

import { Text, View } from "@/components/Themed";
import { signIn } from "@/lib/auth-client";
import { useLocale } from "@/lib/i18n";

/**
 * Email/password sign-in only (H4). No in-app registration: accounts are
 * created via the web onboarding/invite flows (H10, H12) — the mobile app's
 * job is session continuity via Better Auth's Expo plugin + expo-secure-store,
 * not account creation.
 */
export default function SignInScreen() {
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

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.form}>
        <Text style={styles.title}>{t("signInTitle")}</Text>
        <TextInput
          style={styles.input}
          placeholder={t("emailLabel")}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
        <TextInput
          style={styles.input}
          placeholder={t("passwordLabel")}
          secureTextEntry
          autoComplete="password"
          value={password}
          onChangeText={setPassword}
        />
        {error ? <Text style={styles.error}>{t("signInError")}</Text> : null}
        <Pressable
          style={styles.button}
          onPress={onSubmit}
          disabled={submitting || !email || !password}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>{t("signInButton")}</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center" },
  form: { padding: 24, gap: 12 },
  title: { fontSize: 28, fontWeight: "700", marginBottom: 12 },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  button: {
    backgroundColor: "#2f95dc",
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 8,
  },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  error: { color: "#d1453b" },
});
