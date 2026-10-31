import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Linking, Text, useWindowDimensions, View } from "react-native";
import { AuthAlert, AuthButton, AuthHeader, AuthScreen } from "@/components/auth-ui";
import { PressableFeedback } from "@/components/pressable-feedback";
import { alert } from "@/lib/alert";
import { ApiError } from "@/lib/api";
import { errorText } from "@/lib/api-error-reason";
import { forceLocalSignOut, signOut } from "@/lib/auth-client";
import { EVENT_WEBSITE_URL } from "@/lib/env";
import { useLocale } from "@/lib/i18n";
import { clearAccountRemovalProgress } from "@/lib/removal-progress";
import { cancelPendingAnonymization } from "@/lib/self-service";
import type { Me } from "@/lib/types";
import { colors, radius, type } from "@/theme";

type RemovalState = Exclude<Me["removal"], null>;

export function PendingRemovalScreen({
  removal,
  onRefresh,
  refreshError,
}: {
  removal: RemovalState;
  onRefresh: () => Promise<void>;
  refreshError?: Error | null;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const { fontScale } = useWindowDimensions();
  const [now, setNow] = useState(Date.now());
  const [cancelling, setCancelling] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signOutFailed, setSignOutFailed] = useState(false);
  const [refreshFailure, setRefreshFailure] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const refreshInFlight = useRef(false);
  const expiresAt = removal.expiresAt ? Date.parse(removal.expiresAt) : Number.NaN;
  const secondsRemaining = Number.isFinite(expiresAt)
    ? Math.max(0, Math.ceil((expiresAt - now) / 1000))
    : null;
  const countdown = useMemo(
    () =>
      secondsRemaining == null
        ? t("accountRemovalExpiryUnknown")
        : formatCountdown(secondsRemaining),
    [secondsRemaining, t],
  );
  const canCancel = removal.status === "pending_exit" && secondsRemaining !== 0;

  function returnToSignIn() {
    forceLocalSignOut();
    router.replace("/(auth)/sign-in");
  }

  const refresh = useCallback(async () => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    setRefreshing(true);
    try {
      await onRefresh();
      setRefreshFailure(false);
    } catch {
      // Keep the pending-removal screen mounted and expose a retry action when
      // a transient profile refresh cannot confirm the latest server state.
      setRefreshFailure(true);
    } finally {
      refreshInFlight.current = false;
      setRefreshing(false);
    }
  }, [onRefresh]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (secondsRemaining !== 0) return;
    void refresh();
  }, [refresh, secondsRemaining]);

  useEffect(() => {
    const refreshTimer = setInterval(() => void refresh(), 15_000);
    return () => clearInterval(refreshTimer);
  }, [refresh]);

  function confirmCancel() {
    alert(t("accountRemovalCancelTitle"), t("accountRemovalCancelBody"), [
      { text: t("keepAnonymization"), style: "cancel" },
      { text: t("accountRemovalCancel"), style: "destructive", onPress: () => void cancel() },
    ]);
  }

  async function cancel() {
    if (!canCancel || cancelling) return;
    setCancelling(true);
    setError(null);
    setSignOutFailed(false);
    try {
      await cancelPendingAnonymization();
      await clearAccountRemovalProgress();
      await refresh();
    } catch (cause) {
      if (
        cause instanceof ApiError &&
        ["removal_expired", "removal_exit_recorded", "removal_not_cancellable"].includes(
          cause.code ?? "",
        )
      ) {
        await refresh();
      } else {
        setError(errorText(cause, t, t("accountRemovalCancelError")));
      }
    } finally {
      setCancelling(false);
    }
  }

  async function endSession() {
    if (signingOut) return;
    setSigningOut(true);
    setError(null);
    setSignOutFailed(false);
    try {
      const result = await signOut();
      if (result.error) throw new Error(result.error.message || t("signOutError"));
    } catch (cause) {
      setError(errorText(cause, t, t("signOutError")));
      setSignOutFailed(true);
      setSigningOut(false);
    }
  }

  const processing = removal.status === "processing" || secondsRemaining === 0;

  return (
    <AuthScreen scrollable={fontScale > 1.2}>
      <AuthHeader
        align="leading"
        context="hackOS"
        title={t(processing ? "accountRemovalProcessingTitle" : "accountRemovalPendingTitle")}
        description={t(
          processing ? "accountRemovalProcessingDescription" : "accountRemovalPendingDescription",
        )}
      />
      <View style={{ gap: 14 }}>
        <AuthAlert
          message={t(processing ? "accountRemovalProcessingBody" : "accountRemovalPendingBody")}
        />
        {!processing ? (
          <View
            accessibilityLabel={t("accountRemovalExpiry", { time: countdown })}
            accessibilityLiveRegion="polite"
            style={{
              backgroundColor: colors.surface,
              borderColor: colors.separator,
              borderRadius: radius.control,
              borderWidth: 1,
              gap: 4,
              padding: 14,
            }}
          >
            <Text style={{ color: colors.secondaryLabel, fontSize: type.compact.fontSize }}>
              {t("accountRemovalExpiryLabel")}
            </Text>
            <Text
              accessibilityRole="timer"
              style={{ color: colors.label, fontSize: type.title2.fontSize, fontWeight: "700" }}
            >
              {countdown}
            </Text>
            <Text style={{ color: colors.secondaryLabel, fontSize: type.footnote.fontSize }}>
              {t("accountRemovalExpiryHint")}
            </Text>
          </View>
        ) : null}
        {error ? <AuthAlert message={error} /> : null}
        {signOutFailed ? (
          <PressableFeedback
            feedback="opacity"
            accessibilityLabel={t("backToSignIn")}
            accessibilityRole="link"
            onPress={returnToSignIn}
            style={{ alignItems: "center", justifyContent: "center", minHeight: 44 }}
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
          </PressableFeedback>
        ) : null}
        {refreshError || refreshFailure ? (
          <AuthAlert
            testID="account-removal-refresh-error"
            message={t("accountRemovalRefreshError")}
          />
        ) : null}
        {refreshError || refreshFailure ? (
          <AuthButton
            label={t("retry")}
            onPress={() => void refresh()}
            busy={refreshing}
            disabled={refreshing}
          />
        ) : null}
        {!processing ? (
          <AuthButton
            label={t("accountRemovalCancel")}
            onPress={confirmCancel}
            disabled={!canCancel}
            busy={cancelling}
          />
        ) : null}
        <PressableFeedback
          feedback="opacity"
          accessibilityRole="button"
          accessibilityState={{ busy: signingOut, disabled: signingOut }}
          disabled={signingOut}
          onPress={() => void endSession()}
          style={{ alignItems: "center", justifyContent: "center", minHeight: 44 }}
        >
          <Text
            style={{
              color: colors.interactiveText,
              fontSize: type.subhead.fontSize,
              fontWeight: "600",
            }}
          >
            {t("signOut")}
          </Text>
        </PressableFeedback>
        <PressableFeedback
          feedback="opacity"
          accessibilityRole="link"
          onPress={() => void Linking.openURL(`${EVENT_WEBSITE_URL}/privacy`)}
          style={{ alignSelf: "center" }}
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
    </AuthScreen>
  );
}

function formatCountdown(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}h ${minutes.toString().padStart(2, "0")}m`
    : `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}
