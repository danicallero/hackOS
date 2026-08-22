import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { ApiError } from "@/lib/api";
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
  onRetry,
  message,
  retrying = false,
}: {
  error?: Error | null;
  loading?: boolean;
  onRetry?: () => void;
  message?: string;
  retrying?: boolean;
}) {
  const { t } = useLocale();

  if (loading) {
    return (
      <View
        accessibilityLiveRegion="polite"
        accessibilityLabel={t("loading")}
        accessibilityRole="progressbar"
        style={styles.container}
      >
        <ActivityIndicator color={colors.accent} />
        <Text selectable style={[styles.message, { color: colors.secondaryLabel }]}>
          {t("loading")}
        </Text>
      </View>
    );
  }

  if (!error) return null;

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
        {message ?? t(errorKey(error))}
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
