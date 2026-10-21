import { EVENTS } from "@hackos/shared/events";
import { ButtonStyle, ButtonType, RNWalletView } from "@premieroctet/react-native-wallet";
import * as Device from "expo-device";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { useCallback, useEffect, useRef, useState } from "react";
import { Linking, Platform, ScrollView, Text, useColorScheme, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import QRCode from "react-native-qrcode-svg";
import Animated, {
  runOnJS,
  SlideInLeft,
  SlideInRight,
  SlideOutLeft,
  SlideOutRight,
} from "react-native-reanimated";
import { AppRefreshControl } from "@/components/app-refresh-control";
import { ActionButton, EmptyState, InfoRow, Section, Separator } from "@/components/native-ui";
import { NetworkingInvite } from "@/components/networking-invite";
import { RequestFeedback } from "@/components/RequestFeedback";
import { SegmentedControl } from "@/components/segmented-control";
import { StaleDataBanner } from "@/components/stale-data-banner";
import { SymbolView } from "@/components/symbol";
import { alert } from "@/lib/alert";
import { apiFetch } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { API_URL } from "@/lib/env";
import { haptic } from "@/lib/haptics";
import { useLocale } from "@/lib/i18n";
import { createIdempotencyKey } from "@/lib/idempotency-key";
import { useMeContext } from "@/lib/me-context";
import { useRouterTabBarScrollBottomInset } from "@/lib/router-tabs-inset";
import { declineOwnSpot } from "@/lib/self-service";
import { isServerEventConnected, subscribeToServerEvent } from "@/lib/server-events";
import { useCachedApi } from "@/lib/use-cached-api";
import { useTrueTopScroll } from "@/lib/use-true-top-scroll";
import { type WalletTicketPayload, walletCacheKey } from "@/lib/wallet-cache";
import {
  ANDROID_PKPASS_MIME_TYPES,
  PKPASS_MIME_TYPE,
  resolveAppleWalletPass,
  supportsAppleWalletButton,
  supportsAppleWalletFileHandoff,
} from "@/lib/wallet-platform";
import { colors, radius, type } from "@/theme";
import { useParticipantLayout } from "@/theme/layout-participant";

// Roughly the full ticket/badge card's own height (QR + labels + padding).
// The empty state shown before a badge is assigned is much shorter than
// that on its own; this keeps the swipeable area the same size regardless,
// so swiping back from an unassigned badge isn't confined to a sliver of
// the space the real card would occupy.
const WALLET_CARD_MIN_HEIGHT = 400;

/**
 * H28: ticket and badge read model shared with web, with native Wallet handoff.
 * Opened as an overlay of Account, which passes `contentTopInset` to clear its
 * floating close button; the title-less `others/wallet` route serves deep links.
 */
export default function WalletScreen({
  contentTopInset = 0,
  initialPurpose = "ticket",
}: {
  contentTopInset?: number;
  /** Which card shows first; Contacts opens on the badge others scan (#935). */
  initialPurpose?: "ticket" | "badge";
}) {
  useColorScheme();
  const { language, t } = useLocale();
  const [availableWidth, setAvailableWidth] = useState(0);
  const readable = useParticipantLayout("grid");
  const wide = availableWidth >= 720;
  const tabBarBottomInset = useRouterTabBarScrollBottomInset();
  const { me, refetch: refetchMe } = useMeContext();
  const [selectedIndex, setSelectedIndex] = useState(initialPurpose === "badge" ? 1 : 0);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<Error | null>(null);
  const [spotConfirmed, setSpotConfirmed] = useState(false);
  const [spotDeclined, setSpotDeclined] = useState(false);
  const actionRetry = useRef<{ action: () => Promise<void>; key: string } | null>(null);
  const confirmationKeys = useRef(new Map<number, string>());
  const declineKeys = useRef(new Map<number, string>());
  const scrollRef = useRef<ScrollView>(null);

  const trueTop = useTrueTopScroll(scrollRef);

  const fetchTicket = useCallback(() => apiFetch<WalletTicketPayload>("/api/me/ticket"), []);
  const {
    data: ticket,
    loading,
    error,
    staleSince,
    load,
  } = useCachedApi(me ? walletCacheKey(me.id) : "user:unknown:wallet", fetchTicket, {
    enabled: me !== null,
    pollMs: 30_000,
    pollWhen: () => !isServerEventConnected(),
    backgroundRevalidationMs: 0,
    // The QR must open instantly and survive a down or hanging server.
    cacheFirst: true,
  });
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
    const unsubscribeWallet = subscribeToServerEvent(
      EVENTS.LOGISTICS_WALLET_PASS_UPDATED,
      () => void load(),
    );
    const unsubscribeResync = subscribeToServerEvent(EVENTS.REALTIME_RESYNC, () => void load());
    return () => {
      unsubscribeWallet();
      unsubscribeResync();
    };
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

    if (Platform.OS === "android") {
      // H28: resolve all pass MIME aliases in one chooser, including wallets
      // that do not advertise the canonical Apple type. Older dev clients
      // without the native module retain the share/save fallback below.
      const { default: walletHandoff } = await import("@/modules/wallet-handoff");
      if (
        walletHandoff &&
        (await walletHandoff.openPkpass(
          file.contentUri,
          [...ANDROID_PKPASS_MIME_TYPES],
          t("walletDownloadPkpass"),
        ))
      )
        return;
    }

    if (!(await Sharing.isAvailableAsync())) {
      throw new Error("Sharing is not available on this device");
    }
    await Sharing.shareAsync(file.uri, {
      mimeType: PKPASS_MIME_TYPE,
      dialogTitle: Platform.OS === "ios" ? t("addToAppleWallet") : t("walletDownloadPkpass"),
    });
  }

  function goToPurpose(nextIndex: number) {
    setSelectedIndex(nextIndex);
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
    alert(t("walletDeclineSpotTitle"), t("walletDeclineSpotDescription"), [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("walletDeclineSpotAction"),
        style: "destructive",
        onPress: () => void runAction(() => declineSpot(responseId), `decline:${responseId}`),
      },
    ]);
  }

  if (!ticket)
    return (
      <View style={{ flex: 1, justifyContent: "center", padding: 16 }}>
        <RequestFeedback loading={loading} error={error} onRetry={() => void load()} />
      </View>
    );

  // Swipe left/right over the ticket/badge card to switch tabs, instead of
  // only the SegmentedControl above it. activeOffsetX requires a clearly
  // horizontal drag before this claims the gesture at all, and failOffsetY
  // yields immediately to the page's vertical ScrollView otherwise.
  //
  // This gesture sits on a single card nested *inside* the ScrollView. Without an
  // explicit simultaneous relationship the ancestor ScrollView's own native
  // gesture wins outright and this pan gesture never gets to see the touch,
  // so it's declared simultaneous with a `Gesture.Native()` stand-in for the
  // ScrollView (the same technique `ScheduleSwipeRow` uses for its list).
  const scrollNativeGesture = Gesture.Native();
  const walletSwipeGesture = Gesture.Pan()
    .activeOffsetX([-20, 20])
    .failOffsetY([-15, 15])
    .simultaneousWithExternalGesture(scrollNativeGesture)
    .onEnd((event) => {
      if (event.translationX < -60 && selectedIndex < 1) {
        runOnJS(haptic)("selection");
        runOnJS(goToPurpose)(selectedIndex + 1);
      } else if (event.translationX > 60 && selectedIndex > 0) {
        runOnJS(haptic)("selection");
        runOnJS(goToPurpose)(selectedIndex - 1);
      }
    });

  const purpose = selectedIndex === 0 ? "ticket" : "badge";
  const value = purpose === "ticket" ? ticket.ticketToken : ticket.badgeId;
  const label = purpose === "ticket" ? t("ticketLabel") : t("badgeLabel");
  const retryAction = actionRetry.current;
  const actionBusy = busyAction !== null;
  const showAppleWalletButton = supportsAppleWalletButton(Platform.OS, Device.deviceType);
  const showAppleWalletFileHandoff = supportsAppleWalletFileHandoff(Platform.OS, Device.deviceType);

  return (
    <GestureDetector gesture={scrollNativeGesture}>
      <ScrollView
        ref={scrollRef}
        onLayout={(event) => setAvailableWidth(event.nativeEvent.layout.width)}
        {...trueTop.scrollProps}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          gap: 20,
          ...readable.content,
          paddingBottom: Math.max(32, tabBarBottomInset + 16),
          paddingTop: 16 + contentTopInset,
        }}
        refreshControl={
          <AppRefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />
        }
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
              borderRadius: radius.control,
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
              style={{
                color: colors.onSuccessSurface,
                flex: 1,
                fontSize: type.subhead.fontSize,
                lineHeight: 21,
              }}
            >
              {t("walletSpotConfirmed")}
            </Text>
          </View>
        ) : null}
        {spotConfirmed ? <NetworkingInvite /> : null}
        {spotDeclined ? (
          <View
            accessibilityLiveRegion="polite"
            style={{
              backgroundColor: colors.warningSurface,
              borderCurve: "continuous",
              borderRadius: radius.control,
              padding: 14,
            }}
          >
            <Text
              selectable
              style={{
                color: colors.onWarningSurface,
                fontSize: type.subhead.fontSize,
                lineHeight: 21,
              }}
            >
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
                <Text
                  selectable
                  style={{ color: colors.label, fontSize: type.body.fontSize, fontWeight: "600" }}
                >
                  {spot.applicationName}
                </Text>
                <Text
                  selectable
                  style={{
                    color: colors.secondaryLabel,
                    fontSize: type.compact.fontSize,
                    lineHeight: 20,
                  }}
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
                    borderRadius: radius.chip,
                    padding: 12,
                  }}
                >
                  <Text
                    selectable
                    style={{
                      color: colors.onWarningSurface,
                      fontSize: type.compact.fontSize,
                      lineHeight: 20,
                    }}
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

        <View
          style={{
            alignSelf: "center",
            width: "100%",
            flexDirection: wide ? "row" : "column",
            gap: 24,
            alignItems: wide ? "flex-start" : "stretch",
          }}
        >
          <View style={{ flex: wide ? 1 : undefined, gap: 20 }}>
            <View
              style={{
                alignSelf: wide ? "center" : "stretch",
                width: wide ? 320 : undefined,
                maxWidth: "100%",
              }}
            >
              <SegmentedControl
                label={t("tabWallet")}
                values={[t("ticketLabel"), t("badgeLabel")]}
                selectedIndex={selectedIndex}
                onChange={goToPurpose}
              />
            </View>

            <GestureDetector gesture={walletSwipeGesture}>
              {/* A single host View child, not the raw ternary — GestureDetector
            needs to attach to one component that forwards a native ref, and
            `EmptyState` (the other branch) doesn't. `minHeight` keeps that
            host the same size regardless of which branch is showing, so a
            badge that isn't assigned yet (the much shorter `EmptyState`)
            doesn't shrink the swipeable area down to a sliver of the space
            the full ticket/badge card occupies. */}
              <View style={{ justifyContent: "center", minHeight: WALLET_CARD_MIN_HEIGHT }}>
                {/* Keyed on the index so switching sides remounts this node —
                that's what lets `entering`/`exiting` run: the outgoing card
                plays `exiting` while the incoming one plays `entering`,
                simultaneously, in the direction the card just moved. */}
                <Animated.View
                  key={selectedIndex}
                  // Each card has a fixed side, ticket left and badge right, so
                  // its slide follows from its own index. A direction kept in
                  // state would reach the outgoing card one render late, sending
                  // it out on the side the new one comes in from.
                  entering={selectedIndex === 1 ? SlideInRight : SlideInLeft}
                  exiting={selectedIndex === 0 ? SlideOutLeft : SlideOutRight}
                >
                  {value ? (
                    <View
                      style={{
                        alignItems: "center",
                        backgroundColor: colors.surface,
                        borderCurve: "continuous",
                        borderRadius: radius.container,
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
                        <Text
                          selectable
                          style={{
                            color: colors.label,
                            fontSize: type.title2.fontSize,
                            fontWeight: "700",
                          }}
                        >
                          {label}
                        </Text>
                        <Text
                          selectable
                          style={{
                            color: colors.secondaryLabel,
                            fontSize: type.compact.fontSize,
                            textAlign: "center",
                          }}
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
                          borderRadius: radius.container,
                          maxWidth: "100%",
                          padding: 16,
                        }}
                      >
                        <QRCode value={value} size={196} />
                      </View>
                      {purpose === "badge" ? (
                        <Text
                          selectable
                          style={{
                            color: colors.secondaryLabel,
                            fontFamily: "SpaceMono",
                            fontSize: type.footnote.fontSize,
                          }}
                        >
                          {ticket.badgeId}
                        </Text>
                      ) : null}
                    </View>
                  ) : (
                    <EmptyState
                      icon="key.card"
                      title={
                        purpose === "ticket" ? t("ticketNotReadyTitle") : t("badgeNotReadyTitle")
                      }
                      description={purpose === "ticket" ? t("noTicketYet") : t("noBadgeYet")}
                    />
                  )}
                </Animated.View>
              </View>
            </GestureDetector>
          </View>
          <View style={{ flex: wide ? 1 : undefined, gap: 20, paddingTop: wide ? 52 : 0 }}>
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
                  value={roleLabel(me.visibleRoleName, t)}
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
                      onPress={() =>
                        void runAction(() => downloadPkpass(purpose), `wallet:${purpose}`)
                      }
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
                      onPress={() =>
                        void runAction(() => downloadPkpass(purpose), `wallet:${purpose}`)
                      }
                    />
                    <Text
                      selectable
                      style={{
                        color: colors.secondaryLabel,
                        fontSize: type.footnote.fontSize,
                        paddingTop: 4,
                      }}
                    >
                      {t("walletDownloadPkpassHint")}
                    </Text>
                  </View>
                ) : null}
              </Section>
            ) : null}
          </View>
        </View>
      </ScrollView>
    </GestureDetector>
  );
}

function roleLabel(
  role: NonNullable<ReturnType<typeof useMeContext>["me"]>["visibleRoleName"],
  t: ReturnType<typeof useLocale>["t"],
) {
  return role ?? t("roleUnassigned");
}

function isSpotExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  const timestamp = new Date(expiresAt).getTime();
  return Number.isFinite(timestamp) && timestamp <= Date.now();
}
