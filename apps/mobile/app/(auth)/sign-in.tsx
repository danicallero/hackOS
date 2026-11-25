import { UI_TEST_IDS } from "@hackos/shared/ui-test-ids";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Linking, Text, type TextInput, View } from "react-native";
import { AuthAlert, AuthButton, AuthField, AuthHeader, AuthScreen } from "@/components/auth-ui";
import { PressableFeedback } from "@/components/pressable-feedback";
import { alert } from "@/lib/alert";
import { apiFetch } from "@/lib/api";
import { useApiMode } from "@/lib/api-mode";
import { appVersionLabel } from "@/lib/app-version";
import { signIn, signOut } from "@/lib/auth-client";
import { EVENT_WEBSITE_DISPLAY, EVENT_WEBSITE_URL } from "@/lib/env";
import type { MyHelperProfile } from "@/lib/help-desk";
import { useLocale } from "@/lib/i18n";
import { useMeActions } from "@/lib/me-context";
import {
  type AccountRemovalProgress,
  clearAccountRemovalProgress,
  readAccountRemovalProgress,
} from "@/lib/removal-progress";
import { getSignInEmailDraft, setSignInEmailDraft } from "@/lib/sign-in-draft";
import type { PublicEvent } from "@/lib/types";
import { colors, type } from "@/theme";

export default function SignInScreen() {
  const router = useRouter();
  const { accessDenied } = useLocalSearchParams<{ accessDenied?: string }>();
  const { t } = useLocale();
  const { mode, setMode } = useApiMode();
  const { refetch } = useMeActions();
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  // The native fields own their text (Password AutoFill fills them without a JS event), so no
  // `value` is passed and a re-render can never write over them. These mirror what they report.
  const emailText = useRef(getSignInEmailDraft());
  const passwordText = useRef("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [event, setEvent] = useState<PublicEvent | null>(null);
  const [removalProgress, setRemovalProgress] = useState<AccountRemovalProgress | null>(null);
  const developerTapCount = useRef(0);
  const developerTapTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (developerTapTimeout.current) clearTimeout(developerTapTimeout.current);
    },
    [],
  );

  useEffect(() => {
    let active = true;
    void readAccountRemovalProgress().then((progress) => {
      if (active) setRemovalProgress(progress);
    });
    return () => {
      active = false;
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
    alert(
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
    // Ending editing makes iOS report the field's real text, AutoFill's included.
    emailRef.current?.blur();
    passwordRef.current?.blur();
    await Promise.resolve();
    const currentEmail = emailText.current;
    const currentPassword = passwordText.current;
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
        const helper = await apiFetch<MyHelperProfile>("/api/me/helper-profile");
        if (helper.eligible) {
          router.replace("/helper-profile");
          return;
        }
        await signOut();
        router.replace({ pathname: "/(auth)/sign-in", params: { accessDenied: "1" } });
        return;
      }
      setSignInEmailDraft("");
      router.replace("/");
    } catch {
      setError(t("signInError"));
      // Keep the form visible for a sign-in transport failure; /api/me remains
      // the single authoritative session/access/profile read for the app.
    } finally {
      setSubmitting(false);
    }
  }

  function revealDeveloperMode() {
    developerTapCount.current += 1;
    if (developerTapTimeout.current) clearTimeout(developerTapTimeout.current);
    developerTapTimeout.current = setTimeout(() => {
      developerTapCount.current = 0;
    }, 2_000);
    if (developerTapCount.current < 7) return;
    developerTapCount.current = 0;
    alert(
      t("apiModeTitle"),
      mode === "development" ? t("apiModeProductionBody") : t("apiModeDevelopmentBody"),
      [
        { text: t("cancel"), style: "cancel" },
        {
          text: t("apiModeSwitch"),
          onPress: () => {
            void setMode(mode === "development" ? "production" : "development").catch((error) => {
              alert(
                t("apiModeTitle"),
                `${t("apiModeSwitchError")}\n${error instanceof Error ? error.message : String(error)}`,
              );
            });
          },
        },
      ],
    );
  }

  return (
    <AuthScreen
      anchor="top"
      scrollable={false}
      footer={
        <View style={{ alignItems: "center", gap: 4 }}>
          <Text
            selectable
            style={{
              color: colors.label,
              fontSize: type.subhead.fontSize,
              fontWeight: "600",
              lineHeight: 20,
            }}
          >
            {t("eventAccessTitle")}
          </Text>
          <Text
            selectable
            style={{
              color: colors.secondaryLabel,
              fontSize: type.compact.fontSize,
              lineHeight: 20,
              textAlign: "center",
            }}
          >
            {t("eventAccessNotice", { website: EVENT_WEBSITE_DISPLAY })}
          </Text>
          <View style={{ flexDirection: "row", gap: 12, marginTop: 4 }}>
            <PressableFeedback
              feedback="opacity"
              accessibilityRole="link"
              onPress={() => void Linking.openURL(`${EVENT_WEBSITE_URL}/terms`)}
            >
              <Text
                style={{
                  color: colors.secondaryLabel,
                  fontSize: type.footnote.fontSize,
                  textDecorationLine: "underline",
                }}
              >
                {t("accountTerms")}
              </Text>
            </PressableFeedback>
            <PressableFeedback
              feedback="opacity"
              accessibilityRole="link"
              onPress={() => void Linking.openURL(`${EVENT_WEBSITE_URL}/privacy`)}
            >
              <Text
                style={{
                  color: colors.secondaryLabel,
                  fontSize: type.footnote.fontSize,
                  textDecorationLine: "underline",
                }}
              >
                {t("accountPrivacyPolicy")}
              </Text>
            </PressableFeedback>
          </View>
          <PressableFeedback
            feedback="opacity"
            accessibilityLabel={appVersionLabel}
            hitSlop={10}
            onPress={revealDeveloperMode}
            style={{ marginTop: 2, padding: 4 }}
          >
            <Text
              style={{
                color: colors.secondaryLabel,
                fontSize: type.caption.fontSize,
                lineHeight: 18,
              }}
            >
              {appVersionLabel}
            </Text>
          </PressableFeedback>
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
              <PressableFeedback
                feedback="opacity"
                accessibilityRole="link"
                onPress={() => void Linking.openURL(`${EVENT_WEBSITE_URL}/privacy`)}
              >
                <Text
                  style={{
                    color: colors.interactiveText,
                    fontSize: type.footnote.fontSize,
                    textDecorationLine: "underline",
                  }}
                >
                  {t("accountPrivacyPolicy")}
                </Text>
              </PressableFeedback>
              <PressableFeedback
                feedback="opacity"
                accessibilityRole="button"
                onPress={() => void dismissRemovalProgress()}
              >
                <Text
                  style={{
                    color: colors.secondaryLabel,
                    fontSize: type.footnote.fontSize,
                    textDecorationLine: "underline",
                  }}
                >
                  {t("dismiss")}
                </Text>
              </PressableFeedback>
            </View>
          </View>
        ) : null}
        {error ? <AuthAlert message={error} testID={UI_TEST_IDS.auth.error} /> : null}
        <View style={{ gap: 14 }}>
          <AuthField
            testID={UI_TEST_IDS.auth.email}
            inputRef={emailRef}
            label={t("emailLabel")}
            error={emailError}
            autoCapitalize="none"
            autoComplete="username"
            autoCorrect={false}
            importantForAutofill="yes"
            keyboardType="email-address"
            returnKeyType="next"
            spellCheck={false}
            textContentType="username"
            defaultValue={emailText.current}
            onChangeText={(value) => {
              emailText.current = value;
              setSignInEmailDraft(value);
              if (emailError) setEmailError(null);
            }}
            onEndEditing={(event) => {
              emailText.current = event.nativeEvent.text;
              setSignInEmailDraft(event.nativeEvent.text);
            }}
            onSubmitEditing={() => passwordRef.current?.focus()}
          />
          <AuthField
            testID={UI_TEST_IDS.auth.password}
            inputRef={passwordRef}
            label={t("passwordLabel")}
            error={passwordError}
            autoCapitalize="none"
            autoComplete="current-password"
            autoCorrect={false}
            importantForAutofill="yes"
            returnKeyType="go"
            secureTextEntry
            showPasswordLabel={t("showPassword")}
            hidePasswordLabel={t("hidePassword")}
            spellCheck={false}
            textContentType="password"
            onChangeText={(value) => {
              passwordText.current = value;
              if (passwordError) setPasswordError(null);
            }}
            onEndEditing={(event) => {
              passwordText.current = event.nativeEvent.text;
            }}
            onSubmitEditing={() => void onSubmit()}
          />
        </View>

        <PressableFeedback
          feedback="opacity"
          accessibilityRole="link"
          onPress={() =>
            router.push({
              pathname: "/(auth)/forgot-password",
              params: { email: emailText.current.trim() },
            })
          }
          style={{
            alignSelf: "flex-start",
            justifyContent: "center",
            minHeight: 44,
            paddingHorizontal: 4,
          }}
        >
          <Text
            style={{
              color: colors.interactiveText,
              fontSize: type.subhead.fontSize,
              fontWeight: "600",
            }}
          >
            {t("forgotPassword")}
          </Text>
        </PressableFeedback>

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
