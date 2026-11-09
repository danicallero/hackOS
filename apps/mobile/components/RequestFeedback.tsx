import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { AppActivityIndicator } from "@/components/app-activity-indicator";
import { BlankFailure, ErrorNotice, OfflineNotice } from "@/components/status-notice";
import { ApiError } from "@/lib/api";
import { apiErrorCopy } from "@/lib/api-error-reason";
import { useLocale } from "@/lib/i18n";
import { isOfflineError } from "@/lib/offline-error";
import { colors } from "@/theme/colors";

function errorKey(error: Error) {
  if (error instanceof ApiError) {
    if (error.status === 401) return "requestSessionExpired" as const;
    if (error.status === 404) return "requestUnavailable" as const;
    if (error.status >= 500) return "requestServerError" as const;
  }
  return "requestError" as const;
}

/** A non-throwing, retryable state for API-backed mobile screens. */
export function RequestFeedback({
  error,
  loading = false,
  compact = false,
  blank = false,
  onRetry,
  message,
  retrying = false,
}: {
  error?: Error | null;
  loading?: boolean;
  /** Nothing is on screen behind the failure: show a centred empty state, not a notice. */
  blank?: boolean;
  /** Inline spinner beside content that is already on screen (no centred block). */
  compact?: boolean;
  onRetry?: () => void;
  message?: string;
  retrying?: boolean;
}) {
  const { t } = useLocale();
  const { height } = useWindowDimensions();

  if (loading) {
    return (
      <View
        accessibilityLiveRegion="polite"
        accessibilityLabel={t("loading")}
        accessibilityRole="progressbar"
        // Centred in a block taller than the header and Dynamic Island, wherever it is mounted.
        style={[
          styles.container,
          compact ? null : { justifyContent: "center", minHeight: height * 0.6 },
        ]}
      >
        <AppActivityIndicator color={colors.accent} />
        <Text selectable style={[styles.message, { color: colors.secondaryLabel }]}>
          {t("loading")}
        </Text>
      </View>
    );
  }

  if (!error) return null;

  const offline = isOfflineError(error);
  const text = (error instanceof ApiError ? apiErrorCopy(error, t) : message) ?? t(errorKey(error));
  if (blank) return <BlankFailure offline={offline} message={text} onRetry={onRetry} />;
  // Offline (no status): the device, not the server, is the problem.
  if (offline) return <OfflineNotice onReconnect={onRetry} />;

  return <ErrorNotice message={text} onRetry={onRetry} />;
}

const styles = StyleSheet.create({
  container: { alignItems: "center", gap: 10, padding: 16 },
  message: { opacity: 0.7, textAlign: "center" },
});
