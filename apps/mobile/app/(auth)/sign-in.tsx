import { UI_TEST_IDS } from "@hackos/shared/ui-test-ids";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Alert, AppState, Linking, Pressable, Text, View } from "react-native";

import {
  AuthCredentialField,
  type AuthCredentialFieldHandle,
} from "@/components/auth-credential-field";
import { AuthAlert, AuthButton, AuthHeader, AuthScreen } from "@/components/auth-ui";
import { apiFetch } from "@/lib/api";
import { signIn, signOut } from "@/lib/auth-client";
import { EVENT_WEBSITE_DISPLAY, EVENT_WEBSITE_URL } from "@/lib/env";
import { useLocale } from "@/lib/i18n";
import { useMeActions } from "@/lib/me-context";
import {
  type AccountRemovalProgress,
  clearAccountRemovalProgress,
  readAccountRemovalProgress,
} from "@/lib/removal-progress";
import type { PublicEvent } from "@/lib/types";
import { colors } from "@/theme/colors";

export default function SignInScreen() {
  const router = useRouter();
  const { accessDenied } = useLocalSearchParams<{ accessDenied?: string }>();
  const { t } = useLocale();
  const { refetch } = useMeActions();
  const emailRef = useRef<AuthCredentialFieldHandle>(null);
  const passwordRef = useRef<AuthCredentialFieldHandle>(null);
  const focusedFieldRef = useRef<"email" | "password" | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [event, setEvent] = useState<PublicEvent | null>(null);
  const [removalProgress, setRemovalProgress] = useState<AccountRemovalProgress | null>(null);

  useEffect(() => {
    let active = true;
    void readAccountRemovalProgress().then((progress) => {
      if (active) setRemovalProgress(progress);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let appState = AppState.currentState;
    let restoreField: "email" | "password" | null = null;
    let restoreTimeout: ReturnType<typeof setTimeout> | null = null;
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (appState === "active" && nextState.match(/inactive|background/)) {
        restoreField = focusedFieldRef.current;
      }
      if (appState.match(/inactive|background/) && nextState === "active" && restoreField) {
        const field = restoreField;
        // Passwords/Face ID returns focus before its native transition has
        // completely settled. Reassert the field the user initiated from so a
        // late AutoFill event cannot leave focus on the email input.
        restoreTimeout = setTimeout(() => {
          if (field === "email") emailRef.current?.focus();
          else passwordRef.current?.focus();
        }, 250);
      }
      appState = nextState;
    });
    return () => {
      subscription.remove();
      if (restoreTimeout) clearTimeout(restoreTimeout);
    };
  }, []);

  async function dismissRemovalProgress() {
    await clearAccountRemovalProgress();
    setRemovalProgress(null);
  }

  useEffect(() => {
    if (accessDenied !== "1") return;
    // Consume the route signal before opening the native dialog so a later
    // remount cannot announce the same access denial twice.
    router.setParams({ accessDenied: "" });
    Alert.alert(
      t("mobileAccessDeniedTitle"),
      t("mobileAccessDenied", { website: EVENT_WEBSITE_DISPLAY }),
      [{ text: t("close") }],
    );
  }, [accessDenied, router, t]);

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

  async function onSubmit() {
    if (submitting) return;
    const currentEmail = emailRef.current?.getText() ?? email;
    const currentPassword = passwordRef.current?.getText() ?? password;
    const nextEmailError = currentEmail.trim() ? null : t("emailRequired");
    const nextPasswordError = currentPassword ? null : t("passwordRequired");
    setEmailError(nextEmailError);
    setPasswordError(nextPasswordError);
    if (nextEmailError || nextPasswordError) {
      if (nextEmailError) emailRef.current?.focus();
      else passwordRef.current?.focus();
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const { error: signInError } = await signIn.email({
        email: currentEmail.trim(),
        password: currentPassword,
      });
      if (signInError) {
        setError(t("signInError"));
        return;
      }
      const me = await refetch();
      if (!me) {
        setError(t("signInError"));
        return;
      }
      if (!me.hasEventAccess && me.accountState !== "removal_pending") {
        await signOut();
        router.replace({ pathname: "/(auth)/sign-in", params: { accessDenied: "1" } });
        return;
      }
      router.replace("/");
    } catch {
      setError(t("signInError"));
      // Keep the form visible for a sign-in transport failure; /api/me remains
      // the single authoritative session/access/profile read for the app.
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthScreen
      scrollable={false}
      footer={
        <View style={{ alignItems: "center", gap: 4 }}>
          <Text
            selectable
            style={{ color: colors.label, fontSize: 15, fontWeight: "600", lineHeight: 20 }}
          >
            {t("eventAccessTitle")}
          </Text>
          <Text
            selectable
            style={{
              color: colors.secondaryLabel,
              fontSize: 14,
              lineHeight: 20,
              textAlign: "center",
            }}
          >
            {t("eventAccessNotice", { website: EVENT_WEBSITE_DISPLAY })}
          </Text>
          <View style={{ flexDirection: "row", gap: 12, marginTop: 4 }}>
            <Pressable
              accessibilityRole="link"
              onPress={() => void Linking.openURL(`${EVENT_WEBSITE_URL}/terms`)}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            >
              <Text
                style={{
                  color: colors.secondaryLabel,
                  fontSize: 13,
                  textDecorationLine: "underline",
                }}
              >
                {t("accountTerms")}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="link"
              onPress={() => void Linking.openURL(`${EVENT_WEBSITE_URL}/privacy`)}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            >
              <Text
                style={{
                  color: colors.secondaryLabel,
                  fontSize: 13,
                  textDecorationLine: "underline",
                }}
              >
                {t("accountPrivacyPolicy")}
              </Text>
            </Pressable>
          </View>
        </View>
      }
    >
      <AuthHeader align="leading" context={event?.name || "hackOS"} title={t("signInTitle")} />

      <View style={{ gap: 16 }}>
        {removalProgress ? (
          <View style={{ gap: 8 }}>
            <AuthAlert
              message={
                removalProgress.status === "pending_exit"
                  ? t("accountRemovalPendingExit")
                  : removalProgress.status === "device_cleanup_pending"
                    ? t("accountRemovalDeviceCleanupPending")
                    : t("accountRemovalPending")
              }
            />
            <View style={{ alignItems: "center", flexDirection: "row", gap: 16 }}>
              <Pressable
                accessibilityRole="link"
                onPress={() => void Linking.openURL(`${EVENT_WEBSITE_URL}/privacy`)}
                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
              >
                <Text
                  style={{
                    color: colors.interactiveText,
                    fontSize: 13,
                    textDecorationLine: "underline",
                  }}
                >
                  {t("accountPrivacyPolicy")}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => void dismissRemovalProgress()}
                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
              >
                <Text
                  style={{
                    color: colors.secondaryLabel,
                    fontSize: 13,
                    textDecorationLine: "underline",
                  }}
                >
                  {t("dismiss")}
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}
        {error ? <AuthAlert message={error} testID={UI_TEST_IDS.auth.error} /> : null}
        <View style={{ gap: 14 }}>
          <AuthCredentialField
            testID={UI_TEST_IDS.auth.email}
            autoComplete="username"
            fieldRef={emailRef}
            label={t("emailLabel")}
            error={emailError}
            keyboardType="email-address"
            onFocus={() => {
              focusedFieldRef.current = "email";
            }}
            returnKeyType="next"
            onChangeText={(value) => {
              setEmail(value);
              if (emailError) setEmailError(null);
            }}
            onSubmitEditing={() => passwordRef.current?.focus()}
          />
          <AuthCredentialField
            testID={UI_TEST_IDS.auth.password}
            autoComplete="current-password"
            fieldRef={passwordRef}
            label={t("passwordLabel")}
            error={passwordError}
            showPasswordLabel={t("showPassword")}
            hidePasswordLabel={t("hidePassword")}
            returnKeyType="go"
            secureTextEntry
            onFocus={() => {
              focusedFieldRef.current = "password";
            }}
            onChangeText={(value) => {
              setPassword(value);
              if (passwordError) setPasswordError(null);
            }}
            onSubmitEditing={() => void onSubmit()}
          />
        </View>

        <Pressable
          accessibilityRole="link"
          onPress={() =>
            router.push({
              pathname: "/(auth)/forgot-password",
              params: { email: (emailRef.current?.getText() ?? email).trim() },
            })
          }
          style={({ pressed }) => ({
            alignSelf: "flex-start",
            justifyContent: "center",
            minHeight: 44,
            opacity: pressed ? 0.6 : 1,
            paddingHorizontal: 4,
          })}
        >
          <Text style={{ color: colors.interactiveText, fontSize: 15, fontWeight: "600" }}>
            {t("forgotPassword")}
          </Text>
        </Pressable>

        <AuthButton
          label={t("signInButton")}
          testID={UI_TEST_IDS.auth.submit}
          busy={submitting}
          disabled={submitting}
          onPress={() => void onSubmit()}
        />
      </View>
    </AuthScreen>
  );
}
