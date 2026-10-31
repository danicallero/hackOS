import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { AppActivityIndicator } from "@/components/app-activity-indicator";
import { AuthButton, AuthHeader, AuthScreen } from "@/components/auth-ui";
import { forceLocalSignOut } from "@/lib/auth-client";
import { useLocale } from "@/lib/i18n";
import { colors } from "@/theme/colors";
import { type } from "@/theme/tokens";

/** Recoverable H4 session boundary shown while the authenticated profile is unavailable. */
export function SessionState({
  loading,
  offlineAvailable = false,
  onContinueOffline,
  onRetry,
}: {
  loading: boolean;
  offlineAvailable?: boolean;
  onContinueOffline?: () => void;
  onRetry: () => void;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const [showOfflineAction, setShowOfflineAction] = useState(false);

  useEffect(() => {
    if (!offlineAvailable) {
      setShowOfflineAction(false);
      return;
    }
    const timeout = setTimeout(() => setShowOfflineAction(true), 2_000);
    return () => clearTimeout(timeout);
  }, [offlineAvailable]);

  const offlineAction =
    showOfflineAction && onContinueOffline ? (
      <AuthButton label={t("continueOffline")} onPress={onContinueOffline} />
    ) : null;

  function returnToSignIn() {
    forceLocalSignOut();
    router.replace("/(auth)/sign-in");
  }

  if (loading) {
    return (
      <AuthScreen scrollable={false}>
        <View
          accessibilityLabel={t("sessionRestoringTitle")}
          accessibilityLiveRegion="polite"
          accessibilityRole="progressbar"
          style={{ alignItems: "center", gap: 18 }}
        >
          <AppActivityIndicator color={colors.interactiveText} size="large" />
          <View style={{ alignItems: "center", gap: 6 }}>
            <Text
              selectable
              style={{
                color: colors.label,
                fontSize: type.title2.fontSize,
                fontWeight: "700",
                textAlign: "center",
              }}
            >
              {t("sessionRestoringTitle")}
            </Text>
            <Text
              selectable
              style={{
                color: colors.secondaryLabel,
                fontSize: type.subhead.fontSize,
                lineHeight: 21,
                textAlign: "center",
              }}
            >
              {t("sessionRestoringDescription")}
            </Text>
          </View>
        </View>
        {offlineAction}
      </AuthScreen>
    );
  }

  return (
    <AuthScreen scrollable={false}>
      <AuthHeader
        align="leading"
        context="hackOS"
        title={t("sessionRecoveryTitle")}
        description={t("sessionRecoveryDescription")}
      />
      <View style={{ gap: 12 }}>
        <AuthButton label={t("retry")} onPress={onRetry} />
        {offlineAction}
        <Pressable
          accessibilityLabel={t("backToSignIn")}
          accessibilityRole="link"
          onPress={returnToSignIn}
          style={({ pressed }) => ({
            alignItems: "center",
            justifyContent: "center",
            minHeight: 44,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Text
            selectable
            style={{
              color: colors.interactiveText,
              fontSize: type.subhead.fontSize,
              fontWeight: "700",
              textAlign: "center",
            }}
          >
            {t("backToSignIn")}
          </Text>
        </Pressable>
      </View>
    </AuthScreen>
  );
}
