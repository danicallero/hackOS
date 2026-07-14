import { ActivityIndicator, Pressable, StyleSheet } from "react-native";

import { Text, View } from "@/components/Themed";
import { ApiError } from "@/lib/api";
import { useLocale } from "@/lib/i18n";

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
}: {
  error?: Error | null;
  loading?: boolean;
  onRetry?: () => void;
}) {
  const { t } = useLocale();

  if (loading) {
    return (
      <View style={styles.container} accessibilityRole="progressbar">
        <ActivityIndicator />
        <Text style={styles.message}>{t("loading")}</Text>
      </View>
    );
  }

  if (!error) return null;

  return (
    <View style={styles.container} accessibilityRole="alert">
      <Text style={styles.error}>{t(errorKey(error))}</Text>
      {onRetry ? (
        <Pressable accessibilityRole="button" onPress={onRetry} style={styles.button}>
          <Text style={styles.buttonText}>{t("retry")}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: "center", gap: 12, padding: 24 },
  message: { opacity: 0.7, textAlign: "center" },
  error: { color: "#b42318", textAlign: "center" },
  button: {
    minHeight: 44,
    justifyContent: "center",
    borderRadius: 8,
    backgroundColor: "#2f95dc",
    paddingHorizontal: 18,
  },
  buttonText: { color: "#fff", fontWeight: "600" },
});
