import { EVENTS } from "@hackos/shared/events";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { useEffect, useState } from "react";
import { Linking, Pressable, StyleSheet } from "react-native";
import QRCode from "react-native-qrcode-svg";

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

  useEffect(() => {
    const load = () => void apiFetch<TicketPayload>("/api/me/ticket").then(setTicket);
    load();
    return subscribeToServerEvent(EVENTS.LOGISTICS_WALLET_PASS_UPDATED, load);
  }, []);

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

  if (!ticket) return null;

  return (
    <View style={styles.container}>
      {ticket.ticketToken ? (
        <View style={styles.card}>
          <Text style={styles.title}>{t("ticketLabel")}</Text>
          <View style={styles.qrWrap}>
            <QRCode value={ticket.ticketToken} size={200} />
          </View>
          <WalletButtons
            onApple={() => addToAppleWallet("ticket")}
            onGoogle={() => addToGoogleWallet("ticket")}
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
              onApple={() => addToAppleWallet("badge")}
              onGoogle={() => addToGoogleWallet("badge")}
              t={t}
            />
          </>
        ) : (
          <Text style={styles.meta}>{t("noBadgeYet")}</Text>
        )}
      </View>
    </View>
  );
}

function WalletButtons({
  onApple,
  onGoogle,
  t,
}: {
  onApple: () => void;
  onGoogle: () => void;
  t: (key: "addToAppleWallet" | "addToGoogleWallet") => string;
}) {
  return (
    <View style={styles.buttonRow}>
      <Pressable accessibilityRole="button" style={styles.button} onPress={onApple}>
        <Text style={styles.buttonText}>{t("addToAppleWallet")}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" style={styles.button} onPress={onGoogle}>
        <Text style={styles.buttonText}>{t("addToGoogleWallet")}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 16 },
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
