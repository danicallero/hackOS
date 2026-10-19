import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import { SymbolView } from "@/components/symbol";
import { ApiError } from "@/lib/api";
import { apiErrorCopy } from "@/lib/api-error-reason";
import { haptic } from "@/lib/haptics";
import { useLocale } from "@/lib/i18n";
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
  onRetry,
  message,
  retrying = false,
}: {
  error?: Error | null;
  loading?: boolean;
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
        <ActivityIndicator color={colors.accent} />
        <Text selectable style={[styles.message, { color: colors.secondaryLabel }]}>
          {t("loading")}
        </Text>
      </View>
    );
  }

  if (!error) return null;

  // A transport failure has no status: the device, not the server, is the problem.
  if (error instanceof ApiError && !error.status) {
    return (
      <View
        accessibilityLiveRegion="polite"
        accessibilityRole="alert"
        style={[styles.container, styles.offlineContainer]}
      >
        <SymbolView
          name="wifi.slash"
          size={34}
          tintColor={colors.secondaryLabel}
          accessible={false}
        />
        <Text selectable style={[styles.offlineTitle, { color: colors.label }]}>
          {t("requestOfflineTitle")}
        </Text>
        <Text selectable style={[styles.error, { color: colors.secondaryLabel }]}>
          {t("requestOfflineBody")}
        </Text>
        {onRetry ? (
          <Pressable
            accessibilityLabel={t("retry")}
            accessibilityRole="button"
            accessibilityState={{ busy: retrying, disabled: retrying }}
            disabled={retrying}
            onPress={() => {
              void haptic("light");
              onRetry();
            }}
            style={({ pressed }) => [
              styles.button,
              { backgroundColor: colors.surface, opacity: retrying ? 0.45 : pressed ? 0.65 : 1 },
            ]}
          >
            {retrying ? <ActivityIndicator color={colors.accent} size="small" /> : null}
            <Text style={[styles.buttonText, { color: colors.accent }]}>{t("retry")}</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  return (
    <View
      accessibilityLiveRegion="assertive"
      style={[
        styles.container,
        styles.errorContainer,
        { backgroundColor: colors.destructiveSurface },
      ]}
      accessibilityRole="alert"
    >
      <Text selectable style={[styles.error, { color: colors.onDestructiveSurface }]}>
        {(error instanceof ApiError ? apiErrorCopy(error, t) : message) ?? t(errorKey(error))}
      </Text>
      {onRetry ? (
        <Pressable
          accessibilityLabel={t("retry")}
          accessibilityRole="button"
          accessibilityState={{ busy: retrying, disabled: retrying }}
          disabled={retrying}
          onPress={() => {
            void haptic("light");
            onRetry();
          }}
          style={({ pressed }) => [
            styles.button,
            { opacity: retrying ? 0.45 : pressed ? 0.65 : 1 },
          ]}
        >
          {retrying ? <ActivityIndicator color={colors.onDestructiveSurface} size="small" /> : null}
          <Text style={[styles.buttonText, { color: colors.onDestructiveSurface }]}>
            {t("retry")}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: "center", gap: 10, padding: 16 },
  offlineContainer: { gap: 8, paddingVertical: 32 },
  offlineTitle: { fontSize: 17, fontWeight: "600", textAlign: "center" },
  errorContainer: { borderCurve: "continuous", borderRadius: 12 },
  message: { opacity: 0.7, textAlign: "center" },
  error: { textAlign: "center" },
  button: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    minHeight: 44,
    justifyContent: "center",
    borderCurve: "continuous",
    borderRadius: 10,
    paddingHorizontal: 18,
  },
  buttonText: { fontWeight: "600" },
});
