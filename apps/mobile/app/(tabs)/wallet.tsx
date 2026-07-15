import { EVENTS } from "@hackos/shared/events";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useState } from "react";
import { Alert, Linking, Platform, ScrollView, Text, useColorScheme, View } from "react-native";
import QRCode from "react-native-qrcode-svg";

import { ActionButton, EmptyState, InfoRow, Section, Separator } from "@/components/native-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { SegmentedControl } from "@/components/segmented-control";
import { StaleDataBanner } from "@/components/stale-data-banner";
import { apiFetch } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { API_URL } from "@/lib/env";
import { useLocale } from "@/lib/i18n";
import { useMeContext } from "@/lib/me-context";
import { subscribeToServerEvent } from "@/lib/server-events";
import { useCachedApi } from "@/lib/use-cached-api";
import { colors } from "@/theme/colors";

interface TicketPayload {
  userId: number;
  ticketToken: string | null;
  badgeId: string | null;
  acceptedSpots: Array<{
    responseId: number;
    applicationName: string;
    applicationType: string;
    expiresAt: string | null;
  }>;
}

/** Ticket and badge read model shared with web, with native Wallet handoff. */
export default function WalletScreen() {
  useColorScheme();
  const { t } = useLocale();
  const { me, refetch: refetchMe } = useMeContext();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<Error | null>(null);

  const fetchTicket = useCallback(() => apiFetch<TicketPayload>("/api/me/ticket"), []);
  const {
    data: ticket,
    loading,
    error,
    staleSince,
    load,
  } = useCachedApi(`user:${me?.id ?? "unknown"}:wallet`, fetchTicket);

  useEffect(() => {
    void load();
    return subscribeToServerEvent(EVENTS.LOGISTICS_WALLET_PASS_UPDATED, () => void load());
  }, [load]);

  async function addToGoogleWallet(purpose: "ticket" | "badge") {
    const { saveUrl } = await apiFetch<{ saveUrl: string }>(`/api/me/wallet/google/${purpose}`);
    await Linking.openURL(saveUrl);
  }

  async function addToAppleWallet(purpose: "ticket" | "badge") {
    const passUrl = `${API_URL}/api/me/wallet/apple/${purpose}.pkpass`;
    const cookie = authClient.getCookie();
    const { default: WalletManager } = await import("react-native-wallet-manager");
    if (!(await WalletManager.canAddPasses())) {
      throw new Error("This device cannot add Apple Wallet passes");
    }

    try {
      // This native method downloads the authenticated pass and presents
      // PKAddPassesViewController. Unlike the local-file wrapper, it reports
      // PASS_ALREADY_EXISTS instead of silently returning without UI.
      await WalletManager.addPassFromUrl(passUrl, { Cookie: cookie });
    } catch (cause) {
      const code = (cause as { code?: string } | null)?.code;
      if (code === "PASS_ALREADY_EXISTS") {
        Alert.alert(t("walletPassAlreadyAddedTitle"), t("walletPassAlreadyAddedBody"));
        return;
      }
      if (code === "USER_CANCELLED") return;
      throw cause;
    }
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

  async function confirmSpot(responseId: number) {
    await apiFetch(`/api/me/responses/${responseId}/confirm`, {
      method: "POST",
    });
    await Promise.all([load(), refetchMe()]);
  }

  if (!ticket)
    return <RequestFeedback loading={loading} error={error} onRetry={() => void load()} />;

  const purpose = selectedIndex === 0 ? "ticket" : "badge";
  const value = purpose === "ticket" ? ticket.ticketToken : ticket.badgeId;
  const label = purpose === "ticket" ? t("ticketLabel") : t("badgeLabel");

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ gap: 20, padding: 16, paddingBottom: 32 }}
    >
      <StaleDataBanner updatedAt={staleSince} />
      {error ? <RequestFeedback error={error} onRetry={() => void load()} /> : null}
      {actionError ? <RequestFeedback error={actionError} /> : null}

      {ticket.acceptedSpots.map((spot) => (
        <Section
          key={spot.responseId}
          title={t("walletConfirmSpotTitle")}
          footer={
            spot.expiresAt
              ? t("walletConfirmSpotDeadline", {
                  date: new Date(spot.expiresAt).toLocaleString(),
                })
              : undefined
          }
        >
          <View style={{ gap: 12, padding: 16 }}>
            <View style={{ gap: 4 }}>
              <Text selectable style={{ color: colors.label, fontSize: 17, fontWeight: "600" }}>
                {spot.applicationName}
              </Text>
              <Text
                selectable
                style={{ color: colors.secondaryLabel, fontSize: 14, lineHeight: 20 }}
              >
                {t("walletConfirmSpotDescription")}
              </Text>
            </View>
            <ActionButton
              label={t("walletConfirmSpotAction")}
              icon="checkmark.circle.fill"
              busy={actionBusy}
              onPress={() => void runAction(() => confirmSpot(spot.responseId))}
            />
          </View>
        </Section>
      ))}

      <SegmentedControl
        label={t("tabWallet")}
        values={[t("ticketLabel"), t("badgeLabel")]}
        selectedIndex={selectedIndex}
        onChange={setSelectedIndex}
      />

      {value ? (
        <View
          style={{
            alignItems: "center",
            backgroundColor: colors.surface,
            borderCurve: "continuous",
            borderRadius: 20,
            gap: 16,
            padding: 18,
          }}
        >
          <View style={{ alignItems: "center", gap: 5 }}>
            <SymbolView
              name={purpose === "ticket" ? "ticket.fill" : "key.card.fill"}
              tintColor={colors.accent}
              size={28}
              accessible={false}
            />
            <Text selectable style={{ color: colors.label, fontSize: 22, fontWeight: "700" }}>
              {label}
            </Text>
            <Text
              selectable
              style={{ color: colors.secondaryLabel, fontSize: 14, textAlign: "center" }}
            >
              {t("walletScanHint")}
            </Text>
          </View>
          <View
            accessibilityLabel={`${label} QR code`}
            style={{
              backgroundColor: colors.qrBackground,
              borderCurve: "continuous",
              borderRadius: 16,
              padding: 16,
            }}
          >
            <QRCode value={value} size={196} />
          </View>
          {purpose === "badge" ? (
            <Text
              selectable
              style={{ color: colors.secondaryLabel, fontFamily: "SpaceMono", fontSize: 13 }}
            >
              {ticket.badgeId}
            </Text>
          ) : null}
        </View>
      ) : (
        <EmptyState
          icon="key.card"
          title={purpose === "ticket" ? t("ticketNotReadyTitle") : t("badgeNotReadyTitle")}
          description={purpose === "ticket" ? t("noTicketYet") : t("noBadgeYet")}
        />
      )}

      {/*
        Readable identity info alongside the QR — useful for anyone who isn't
        adding this to Apple/Google Wallet and just wants to confirm it's
        their own pass at a glance.
      */}
      {value && me ? (
        <Section title={t("walletHolder")}>
          <InfoRow
            icon="person"
            label={t("walletHolderName")}
            value={[me.name, me.surname].filter(Boolean).join(" ") || me.email}
          />
          <Separator />
          <InfoRow
            icon="checkmark.seal"
            label={t("walletHolderRole")}
            value={roleLabel(me.role, t)}
          />
        </Section>
      ) : null}

      {value ? (
        <Section title={t("walletAddPass")} footer={t("walletAddPassHint")}>
          {Platform.OS !== "android" ? (
            <ActionButton
              label={t("addToAppleWallet")}
              icon="wallet.pass.fill"
              busy={actionBusy}
              onPress={() => void runAction(() => addToAppleWallet(purpose))}
            />
          ) : null}
          {Platform.OS !== "android" ? <Separator /> : null}
          <ActionButton
            label={t("addToGoogleWallet")}
            icon="wallet.pass"
            busy={actionBusy}
            onPress={() => void runAction(() => addToGoogleWallet(purpose))}
          />
        </Section>
      ) : null}
    </ScrollView>
  );
}

function roleLabel(
  role: NonNullable<ReturnType<typeof useMeContext>["me"]>["role"],
  t: ReturnType<typeof useLocale>["t"],
) {
  return (
    {
      admin: t("roleAdmin"),
      judge: t("roleJudge"),
      sponsor: t("roleSponsor"),
      staff: t("roleStaff"),
      participant: t("roleParticipant"),
    } as const
  )[role];
}
