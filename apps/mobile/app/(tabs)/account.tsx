import { router } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet } from "react-native";

import { RequestFeedback } from "@/components/RequestFeedback";
import { Text, View } from "@/components/Themed";
import { signOut } from "@/lib/auth-client";
import { useLocale } from "@/lib/i18n";
import { useMeContext } from "@/lib/me-context";

/** H4/H55: account details and explicit management of this device's session. */
export default function AccountScreen() {
  const { t } = useLocale();
  const { me, loading, error, refetch } = useMeContext();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<Error | null>(null);

  async function endSession() {
    setSigningOut(true);
    setSignOutError(null);
    try {
      await signOut();
      router.replace("/(auth)/sign-in");
    } catch (cause) {
      setSignOutError(cause instanceof Error ? cause : new Error("Sign out failed"));
      setSigningOut(false);
    }
  }

  function confirmSignOut() {
    Alert.alert(t("signOutConfirmTitle"), t("signOutConfirmBody"), [
      { text: t("cancel"), style: "cancel" },
      { text: t("signOut"), style: "destructive", onPress: () => void endSession() },
    ]);
  }

  const fullName = [me?.name, me?.surname].filter(Boolean).join(" ");

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.pageTitle}>{t("accountTitle")}</Text>
      {loading && !me ? <RequestFeedback loading /> : null}
      {error ? <RequestFeedback error={error} onRetry={() => void refetch()} /> : null}

      {me ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t("accountProfile")}</Text>
          <ProfileRow label={t("accountName")} value={fullName || "—"} />
          <ProfileRow label={t("accountEmail")} value={me.email} />
          <ProfileRow label={t("accountLanguage")} value={me.language.toUpperCase()} />
          <ProfileRow label={t("accountBadge")} value={me.badgeId ?? t("accountNoBadge")} />
          <Pressable
            accessibilityRole="button"
            disabled={loading}
            onPress={() => void refetch()}
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
          >
            <Text style={styles.secondaryButtonText}>{t("refreshAccount")}</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t("sessionTitle")}</Text>
        {me ? <Text style={styles.hint}>{t("sessionActive", { email: me.email })}</Text> : null}
        {signOutError ? <Text style={styles.error}>{t("signOutError")}</Text> : null}
        <Pressable
          accessibilityRole="button"
          disabled={signingOut}
          onPress={confirmSignOut}
          style={({ pressed }) => [styles.dangerButton, pressed && styles.pressed]}
        >
          <Text style={styles.dangerButtonText}>{signingOut ? t("loading") : t("signOut")}</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

function ProfileRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value} selectable>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { gap: 16, padding: 16 },
  pageTitle: { fontSize: 28, fontWeight: "700" },
  card: {
    gap: 14,
    padding: 16,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#ccc",
  },
  cardTitle: { fontSize: 18, fontWeight: "700" },
  row: { gap: 3 },
  label: { fontSize: 13, opacity: 0.65 },
  value: { fontSize: 16 },
  hint: { opacity: 0.7 },
  error: { color: "#b42318" },
  secondaryButton: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#2f95dc",
    paddingHorizontal: 16,
  },
  secondaryButtonText: { color: "#2f95dc", fontWeight: "600" },
  dangerButton: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    backgroundColor: "#b42318",
    paddingHorizontal: 16,
  },
  dangerButtonText: { color: "#fff", fontWeight: "700" },
  pressed: { opacity: 0.75 },
});
