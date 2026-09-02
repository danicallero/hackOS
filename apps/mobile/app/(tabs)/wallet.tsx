import { EVENTS } from "@hackos/shared/events";
import { ButtonStyle, ButtonType, RNWalletView } from "@premieroctet/react-native-wallet";
import * as Device from "expo-device";
import { File, Paths } from "expo-file-system";
import { useScrollToTop } from "expo-router";
import * as Sharing from "expo-sharing";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Linking,
  Platform,
  RefreshControl,
  ScrollView,
  Text,
  useColorScheme,
  View,
} from "react-native";
import QRCode from "react-native-qrcode-svg";
import { ActionButton, EmptyState, InfoRow, Section, Separator } from "@/components/native-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { SegmentedControl } from "@/components/segmented-control";
import { StaleDataBanner } from "@/components/stale-data-banner";
import { SymbolView } from "@/components/symbol";
import { apiFetch } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { API_URL } from "@/lib/env";
import { haptic } from "@/lib/haptics";
import { useLocale } from "@/lib/i18n";
import { createIdempotencyKey } from "@/lib/idempotency-key";
import { useMeContext } from "@/lib/me-context";
import { useRouterTabBarScrollBottomInset } from "@/lib/router-tabs-inset";
import { declineOwnSpot } from "@/lib/self-service";
import { subscribeToServerEvent } from "@/lib/server-events";
import { useAndroidTopInset } from "@/lib/use-android-top-inset";
import { useCachedApi } from "@/lib/use-cached-api";
import { type WalletTicketPayload, walletCacheKey } from "@/lib/wallet-cache";
import {
  resolveAppleWalletPass,
  supportsAppleWalletButton,
  supportsAppleWalletFileHandoff,
} from "@/lib/wallet-platform";
import { colors } from "@/theme/colors";

/** Ticket and badge read model shared with web, with native Wallet handoff. */
export default function WalletScreen() {
  useColorScheme();
  const { language, t } = useLocale();
  const androidTopInset = useAndroidTopInset();
  const tabBarBottomInset = useRouterTabBarScrollBottomInset();
  const { me, refetch: refetchMe } = useMeContext();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<Error | null>(null);
  const [spotConfirmed, setSpotConfirmed] = useState(false);
  const [spotDeclined, setSpotDeclined] = useState(false);
  const actionRetry = useRef<{ action: () => Promise<void>; key: string } | null>(null);
  const confirmationKeys = useRef(new Map<number, string>());
  const declineKeys = useRef(new Map<number, string>());
  const scrollRef = useRef<ScrollView>(null);

  useScrollToTop(scrollRef);

  const fetchTicket = useCallback(() => apiFetch<WalletTicketPayload>("/api/me/ticket"), []);
  const {
    data: ticket,
    loading,
    error,
    staleSince,
    load,
  } = useCachedApi(me ? walletCacheKey(me.id) : "user:unknown:wallet", fetchTicket);
  const [refreshing, setRefreshing] = useState(false);

  async function onRefresh() {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }

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
        const latestTicket = ticket!.applePassSerialNumbers[purpose]
          ? ticket!
          : await fetchTicket();
        const pass = resolveAppleWalletPass(
          latestTicket.applePassTypeIdentifier,
          latestTicket.applePassSerialNumbers,
          purpose,
        );
        if (!pass) throw new Error("The account's Apple Wallet pass could not be identified");
        const opened = await WalletManager.viewInWallet(pass.cardIdentifier, pass.serialNumber);
        if (!opened) throw new Error("The account's Apple Wallet pass could not be opened");
        return;
      }
      if (code === "USER_CANCELLED") return;
      throw cause;
    }
  }

  /**
   * The `.pkpass` file is a portable, signed archive. This mirrors the web
   * download on macOS, where PKAddPassButton is unavailable, and also lets
   * Android users route it to a compatible wallet app. The authenticated
   * download happens inside the app before the system share sheet opens.
   */
  async function downloadPkpass(purpose: "ticket" | "badge") {
    const passUrl = `${API_URL}/api/me/wallet/apple/${purpose}.pkpass`;
    const cookie = authClient.getCookie();
    const destination = new File(Paths.cache, `${purpose}.pkpass`);
    const file = await File.downloadFileAsync(passUrl, destination, {
      headers: { Cookie: cookie },
      idempotent: true,
    });
    if (!(await Sharing.isAvailableAsync())) {
      throw new Error("Sharing is not available on this device");
    }
    await Sharing.shareAsync(file.uri, {
      mimeType: "application/vnd.apple.pkpass",
      dialogTitle: Platform.OS === "ios" ? t("addToAppleWallet") : t("walletDownloadPkpass"),
    });
  }

  async function runAction(action: () => Promise<void>, key = "wallet") {
    actionRetry.current = { action, key };
    setBusyAction(key);
    setActionError(null);
    try {
      await action();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause : new Error(t("walletActionError")));
    } finally {
      setBusyAction(null);
    }
  }

  async function confirmSpot(responseId: number) {
    const key = confirmationKeys.current.get(responseId) ?? createIdempotencyKey();
    confirmationKeys.current.set(responseId, key);
    await apiFetch(`/api/me/responses/${responseId}/confirm`, {
      method: "POST",
      headers: { "Idempotency-Key": key },
    });
    setSpotConfirmed(true);
    void haptic("success");
    await Promise.all([load(), refetchMe()]);
  }

  async function declineSpot(responseId: number) {
    const key = declineKeys.current.get(responseId) ?? createIdempotencyKey();
    declineKeys.current.set(responseId, key);
    await declineOwnSpot(responseId, key);
    setSpotDeclined(true);
    void haptic("warning");
    await Promise.all([load(), refetchMe()]);
  }

  function confirmDeclineSpot(responseId: number) {
    Alert.alert(t("walletDeclineSpotTitle"), t("walletDeclineSpotDescription"), [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("walletDeclineSpotAction"),
        style: "destructive",
        onPress: () => void runAction(() => declineSpot(responseId), `decline:${responseId}`),
      },
    ]);
  }

  if (!ticket)
    return <RequestFeedback loading={loading} error={error} onRetry={() => void load()} />;

  const purpose = selectedIndex === 0 ? "ticket" : "badge";
  const value = purpose === "ticket" ? ticket.ticketToken : ticket.badgeId;
  const label = purpose === "ticket" ? t("ticketLabel") : t("badgeLabel");
  const retryAction = actionRetry.current;
  const actionBusy = busyAction !== null;
  const showAppleWalletButton = supportsAppleWalletButton(Platform.OS, Device.deviceType);
  const showAppleWalletFileHandoff = supportsAppleWalletFileHandoff(Platform.OS, Device.deviceType);

  return (
    <ScrollView
      ref={scrollRef}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{
        gap: 20,
        padding: 16,
        paddingBottom: Math.max(32, tabBarBottomInset + 16),
        paddingTop: 16 + androidTopInset,
      }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />}
    >
      <StaleDataBanner updatedAt={staleSince} />
      {error ? <RequestFeedback error={error} onRetry={() => void load()} /> : null}
      {actionError ? (
        <RequestFeedback
          error={actionError}
          message={t("walletActionError")}
          onRetry={
            retryAction ? () => void runAction(retryAction.action, retryAction.key) : undefined
          }
          retrying={actionBusy}
        />
      ) : null}
      {spotConfirmed ? (
        <View
          accessibilityLiveRegion="polite"
          style={{
            backgroundColor: colors.successSurface,
            borderCurve: "continuous",
            borderRadius: 12,
            flexDirection: "row",
            gap: 9,
            padding: 14,
          }}
        >
          <SymbolView
            name="checkmark.circle.fill"
            tintColor={colors.onSuccessSurface}
            size={21}
            accessible={false}
          />
          <Text
            selectable
            style={{ color: colors.onSuccessSurface, flex: 1, fontSize: 15, lineHeight: 21 }}
          >
            {t("walletSpotConfirmed")}
          </Text>
        </View>
      ) : null}
      {spotDeclined ? (
        <View
          accessibilityLiveRegion="polite"
          style={{
            backgroundColor: colors.warningSurface,
            borderCurve: "continuous",
            borderRadius: 12,
            padding: 14,
          }}
        >
          <Text selectable style={{ color: colors.onWarningSurface, fontSize: 15, lineHeight: 21 }}>
            {t("walletSpotDeclined")}
          </Text>
        </View>
      ) : null}

      {ticket.acceptedSpots.map((spot) => (
        <Section
          key={spot.responseId}
          title={t("walletConfirmSpotTitle")}
          footer={
            spot.expiresAt
              ? t("walletConfirmSpotDeadline", {
                  date: new Date(spot.expiresAt).toLocaleString(language),
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
            {isSpotExpired(spot.expiresAt) ? (
              <View
                accessibilityLiveRegion="polite"
                style={{
                  backgroundColor: colors.warningSurface,
                  borderCurve: "continuous",
                  borderRadius: 10,
                  padding: 12,
                }}
              >
                <Text
                  selectable
                  style={{ color: colors.onWarningSurface, fontSize: 14, lineHeight: 20 }}
                >
                  {t("walletSpotExpired")}
                </Text>
              </View>
            ) : (
              <ActionButton
                label={t("walletConfirmSpotAction")}
                icon="checkmark.circle.fill"
                haptic={false}
                busy={busyAction === `spot:${spot.responseId}`}
                onPress={() =>
                  void runAction(() => confirmSpot(spot.responseId), `spot:${spot.responseId}`)
                }
              />
            )}
            <ActionButton
              label={t("walletDeclineSpotAction")}
              icon="xmark.circle"
              destructive
              busy={busyAction === `decline:${spot.responseId}`}
              onPress={() => confirmDeclineSpot(spot.responseId)}
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
            accessibilityLabel={t("walletQrCode", { label })}
            accessibilityRole="image"
            accessible
            style={{
              backgroundColor: colors.qrBackground,
              borderCurve: "continuous",
              borderRadius: 16,
              maxWidth: "100%",
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

      {value &&
      (showAppleWalletButton || showAppleWalletFileHandoff || Platform.OS === "android") ? (
        <Section title={t("walletAddPass")} footer={t("walletAddPassHint")}>
          {showAppleWalletButton ? (
            <View style={{ padding: 16 }}>
              {/*
                Apple's Add to Apple Wallet guidelines require apps to use
                the system PKAddPassButton control rather than custom badge
                artwork or a styled button; the system picks one- or
                two-line text layout based on the width available.
              */}
              <RNWalletView
                buttonStyle={ButtonStyle.BLACK}
                onPress={() => {
                  if (!actionBusy)
                    void runAction(() => addToAppleWallet(purpose), `wallet:${purpose}`);
                }}
                style={{ height: 44, opacity: actionBusy ? 0.5 : 1, width: "100%" }}
              />
            </View>
          ) : null}
          {showAppleWalletButton ? <Separator /> : null}
          {showAppleWalletFileHandoff ? (
            <View style={{ padding: 16 }}>
              <ActionButton
                label={t("addToAppleWallet")}
                icon="arrow.down.circle"
                busy={busyAction === `wallet:${purpose}`}
                onPress={() => void runAction(() => downloadPkpass(purpose), `wallet:${purpose}`)}
              />
            </View>
          ) : null}
          {Platform.OS === "android" ? (
            <View style={{ alignItems: "center", padding: 16 }}>
              {/*
                Google's Add to Google Wallet brand guidelines require the
                official button asset (bundled natively by this library) —
                no custom button, recoloring, or free-scaling.
              */}
              <RNWalletView
                buttonType={ButtonType.PRIMARY}
                onPress={() => {
                  if (!actionBusy)
                    void runAction(() => addToGoogleWallet(purpose), `wallet:${purpose}`);
                }}
                style={{ opacity: actionBusy ? 0.5 : 1 }}
              />
            </View>
          ) : null}
          {Platform.OS === "android" ? <Separator /> : null}
          {Platform.OS === "android" ? (
            <View style={{ padding: 16 }}>
              <ActionButton
                label={t("walletDownloadPkpass")}
                icon="arrow.down.circle"
                busy={busyAction === `wallet:${purpose}`}
                onPress={() => void runAction(() => downloadPkpass(purpose), `wallet:${purpose}`)}
              />
              <Text
                selectable
                style={{ color: colors.secondaryLabel, fontSize: 13, paddingTop: 4 }}
              >
                {t("walletDownloadPkpassHint")}
              </Text>
            </View>
          ) : null}
        </Section>
      ) : null}
    </ScrollView>
  );
}

function roleLabel(
  role: NonNullable<ReturnType<typeof useMeContext>["me"]>["role"],
  t: ReturnType<typeof useLocale>["t"],
) {
  return role ?? t("roleUnassigned");
}

function isSpotExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  const timestamp = new Date(expiresAt).getTime();
  return Number.isFinite(timestamp) && timestamp <= Date.now();
}
