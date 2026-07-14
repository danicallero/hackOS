import { EVENTS } from "@hackos/shared/events";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { useCallback, useEffect, useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet } from "react-native";
import QRCode from "react-native-qrcode-svg";

import { RequestFeedback } from "@/components/RequestFeedback";
import { Text, View } from "@/components/Themed";
import { apiFetch } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { API_URL } from "@/lib/env";
import { useLocale } from "@/lib/i18n";
import { subscribeToServerEvent } from "@/lib/server-events";

interface TicketPayload {
  userId: number;
  ticketToken: string | null;
  badgeId: string | null;
}

/** H28: ticket/badge QR + Apple/Google Wallet entry points. */
export default function WalletScreen() {
  const { t } = useLocale();
  const [ticket, setTicket] = useState<TicketPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setTicket(await apiFetch<TicketPayload>("/api/me/ticket"));
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error("Failed to load wallet"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    return subscribeToServerEvent(EVENTS.LOGISTICS_WALLET_PASS_UPDATED, () => void load());
  }, [load]);

  async function addToGoogleWallet(purpose: "ticket" | "badge") {
    const { saveUrl } = await apiFetch<{ saveUrl: string }>(`/api/me/wallet/google/${purpose}`);
    await Linking.openURL(saveUrl);
  }

  async function addToAppleWallet(purpose: "ticket" | "badge") {
    const destination = `${FileSystem.cacheDirectory}${purpose}.pkpass`;
    const download = await FileSystem.downloadAsync(
      `${API_URL}/api/me/wallet/apple/${purpose}.pkpass`,
      destination,
      { headers: { cookie: authClient.getCookie() } },
    );
    if (download.status !== 200)
      throw new Error(`Wallet pass download failed (${download.status})`);
    await Sharing.shareAsync(download.uri, {
      mimeType: "application/vnd.apple.pkpass",
      UTI: "com.apple.pkpass",
    });
  }

  async function runAction(action: () => Promise<void>) {
    setActionBusy(true);
    setActionError(null);
    try {
      await action();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause : new Error("Wallet action failed"));
    } finally {
      setActionBusy(false);
    }
  }

  if (!ticket)
    return <RequestFeedback loading={loading} error={error} onRetry={() => void load()} />;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {error ? <RequestFeedback error={error} onRetry={() => void load()} /> : null}
      {actionError ? <RequestFeedback error={actionError} /> : null}
      {ticket.ticketToken ? (
        <View style={styles.card}>
          <Text style={styles.title}>{t("ticketLabel")}</Text>
          <View style={styles.qrWrap}>
            <QRCode value={ticket.ticketToken} size={200} />
          </View>
          <WalletButtons
            disabled={actionBusy}
            onApple={() => void runAction(() => addToAppleWallet("ticket"))}
            onGoogle={() => void runAction(() => addToGoogleWallet("ticket"))}
            t={t}
          />
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.title}>{t("badgeLabel")}</Text>
        {ticket.badgeId ? (
          <>
            <View style={styles.qrWrap}>
              <QRCode value={ticket.badgeId} size={200} />
            </View>
            <WalletButtons
              disabled={actionBusy}
              onApple={() => void runAction(() => addToAppleWallet("badge"))}
              onGoogle={() => void runAction(() => addToGoogleWallet("badge"))}
              t={t}
            />
          </>
        ) : (
          <Text style={styles.meta}>{t("noBadgeYet")}</Text>
        )}
      </View>
    </ScrollView>
  );
}

function WalletButtons({
  onApple,
  onGoogle,
  disabled,
  t,
}: {
  onApple: () => void;
  onGoogle: () => void;
  disabled: boolean;
  t: (key: "addToAppleWallet" | "addToGoogleWallet") => string;
}) {
  return (
    <View style={styles.buttonRow}>
      <Pressable
        accessibilityRole="button"
        disabled={disabled}
        style={styles.button}
        onPress={onApple}
      >
        <Text style={styles.buttonText}>{t("addToAppleWallet")}</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        disabled={disabled}
        style={styles.button}
        onPress={onGoogle}
      >
        <Text style={styles.buttonText}>{t("addToGoogleWallet")}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 16 },
  card: {
    alignItems: "center",
    gap: 12,
    padding: 16,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#ccc",
  },
  title: { fontSize: 18, fontWeight: "700" },
  meta: { opacity: 0.7 },
  qrWrap: { padding: 12, backgroundColor: "#fff", borderRadius: 8 },
  buttonRow: { flexDirection: "row", gap: 8 },
  button: {
    backgroundColor: "#2f95dc",
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  buttonText: { color: "#fff", fontWeight: "600" },
});
