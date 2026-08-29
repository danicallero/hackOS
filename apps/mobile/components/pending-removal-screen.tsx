import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Linking, Pressable, Text, useWindowDimensions, View } from "react-native";

import { AuthAlert, AuthButton, AuthHeader, AuthScreen } from "@/components/auth-ui";
import { ApiError } from "@/lib/api";
import { signOut } from "@/lib/auth-client";
import { EVENT_WEBSITE_URL } from "@/lib/env";
import { useLocale } from "@/lib/i18n";
import { clearAccountRemovalProgress } from "@/lib/removal-progress";
import { cancelPendingAnonymization } from "@/lib/self-service";
import type { Me } from "@/lib/types";
import { colors } from "@/theme/colors";

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
  const { fontScale } = useWindowDimensions();
  const [now, setNow] = useState(Date.now());
  const [cancelling, setCancelling] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    Alert.alert(t("accountRemovalCancelTitle"), t("accountRemovalCancelBody"), [
      { text: t("keepAnonymization"), style: "cancel" },
      { text: t("accountRemovalCancel"), style: "destructive", onPress: () => void cancel() },
    ]);
  }

  async function cancel() {
    if (!canCancel || cancelling) return;
    setCancelling(true);
    setError(null);
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
        setError(cause instanceof Error ? cause.message : t("accountRemovalCancelError"));
      }
    } finally {
      setCancelling(false);
    }
  }

  async function endSession() {
    if (signingOut) return;
    setSigningOut(true);
    setError(null);
    try {
      const result = await signOut();
      if (result.error) throw new Error(result.error.message || t("signOutError"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("signOutError"));
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
              borderRadius: 12,
              borderWidth: 1,
              gap: 4,
              padding: 14,
            }}
          >
            <Text style={{ color: colors.secondaryLabel, fontSize: 14 }}>
              {t("accountRemovalExpiryLabel")}
            </Text>
            <Text
              accessibilityRole="timer"
              style={{ color: colors.label, fontSize: 24, fontWeight: "800" }}
            >
              {countdown}
            </Text>
            <Text style={{ color: colors.secondaryLabel, fontSize: 13 }}>
              {t("accountRemovalExpiryHint")}
            </Text>
          </View>
        ) : null}
        {error ? <AuthAlert message={error} /> : null}
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
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ busy: signingOut, disabled: signingOut }}
          disabled={signingOut}
          onPress={() => void endSession()}
          style={({ pressed }) => ({
            alignItems: "center",
            justifyContent: "center",
            minHeight: 44,
            opacity: signingOut ? 0.45 : pressed ? 0.6 : 1,
          })}
        >
          <Text style={{ color: colors.interactiveText, fontSize: 15, fontWeight: "600" }}>
            {t("signOut")}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="link"
          onPress={() => void Linking.openURL(`${EVENT_WEBSITE_URL}/privacy`)}
          style={({ pressed }) => ({ alignSelf: "center", opacity: pressed ? 0.6 : 1 })}
        >
          <Text
            style={{ color: colors.secondaryLabel, fontSize: 13, textDecorationLine: "underline" }}
          >
            {t("accountPrivacyPolicy")}
          </Text>
        </Pressable>
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
