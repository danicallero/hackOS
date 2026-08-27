import { type MenuAction, MenuView } from "@expo/ui/community/menu";
import { useRouter, useScrollToTop } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Linking, ScrollView, Text, useColorScheme, View } from "react-native";
import {
  type AccountRemovalPinAction,
  AccountRemovalPinModal,
} from "@/components/account-removal-pin-modal";
import {
  ActionButton,
  AndroidStatusBarScrim,
  InfoRow,
  Section,
  Separator,
  StatusPill,
} from "@/components/native-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { ApiError, apiFetch } from "@/lib/api";
import { signOut } from "@/lib/auth-client";
import { EVENT_WEBSITE_URL } from "@/lib/env";
import { haptic } from "@/lib/haptics";
import { type Lang, useLocale } from "@/lib/i18n";
import { useMeContext } from "@/lib/me-context";
import {
  type AccountRemovalProgress,
  clearAccountRemovalProgress,
  saveAccountRemovalProgress,
} from "@/lib/removal-progress";
import { useRouterTabBarScrollBottomInset } from "@/lib/router-tabs-inset";
import { fetchMyScanStats, type MyScanStats } from "@/lib/scan-log";
import { SCAN_LOG_ROUTES } from "@/lib/scan-log-navigation";
import { wipeAttendanceRoster } from "@/lib/scanner-db";
import {
  type AccountRemovalEligibility,
  anonymizeOwnAccount,
  deleteOwnAccount,
  fetchAccountRemovalEligibility,
  requestAccountRemovalPin,
} from "@/lib/self-service";
import {
  clearAccountData,
  clearAllCaches,
  formatBytes,
  getStorageUsage,
  type StorageUsage,
} from "@/lib/storage-usage";
import { isOperator } from "@/lib/tabs";
import { useAndroidTopInset } from "@/lib/use-android-top-inset";
import { colors } from "@/theme/colors";

interface Intolerance {
  id: number;
  label: { en: string; es: string; gl: string };
}

const LANGUAGES: Lang[] = ["en", "es", "gl"];

/** Account overview with the same participant-owned profile fields exposed on web. */
export default function AccountScreen() {
  useColorScheme();
  const router = useRouter();
  const { t, language } = useLocale();
  const androidTopInset = useAndroidTopInset();
  const tabBarBottomInset = useRouterTabBarScrollBottomInset();
  const scrollRef = useRef<ScrollView>(null);
  useScrollToTop(scrollRef);
  const { me, loading, error, refetch } = useMeContext();
  const [intolerances, setIntolerances] = useState<Intolerance[]>([]);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<Error | null>(null);
  const [savingLanguage, setSavingLanguage] = useState(false);
  const [languageError, setLanguageError] = useState<Error | null>(null);
  const [languageRetry, setLanguageRetry] = useState<Lang | null>(null);
  const [myStats, setMyStats] = useState<MyScanStats | null>(null);
  const [storageUsage, setStorageUsage] = useState<StorageUsage | null>(null);
  const [clearingCache, setClearingCache] = useState(false);
  const [storageError, setStorageError] = useState<Error | null>(null);
  const [dangerZoneOpen, setDangerZoneOpen] = useState(false);
  const [removalEligibility, setRemovalEligibility] = useState<AccountRemovalEligibility | null>(
    null,
  );
  const [removalLoading, setRemovalLoading] = useState(true);
  const [removalError, setRemovalError] = useState<Error | null>(null);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [removalPinAction, setRemovalPinAction] = useState<AccountRemovalPinAction | null>(null);
  const [removalPinStatic, setRemovalPinStatic] = useState(false);
  const [removalPinError, setRemovalPinError] = useState<string | null>(null);
  const [removalPinRequestAction, setRemovalPinRequestAction] =
    useState<AccountRemovalPinAction | null>(null);
  const [removalPinRequestError, setRemovalPinRequestError] = useState<Error | null>(null);
  const [requestingRemovalPin, setRequestingRemovalPin] = useState(false);

  const loadStorageUsage = useCallback(async () => {
    setStorageUsage(await getStorageUsage());
  }, []);

  useEffect(() => {
    void loadStorageUsage();
  }, [loadStorageUsage]);

  const loadRemovalEligibility = useCallback(async () => {
    setRemovalLoading(true);
    setRemovalError(null);
    try {
      setRemovalEligibility(await fetchAccountRemovalEligibility());
    } catch (cause) {
      setRemovalError(cause instanceof Error ? cause : new Error(t("accountRemovalLoadError")));
    } finally {
      setRemovalLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadRemovalEligibility();
  }, [loadRemovalEligibility]);

  const loadSupportingData = useCallback(async () => {
    if (!me) return;
    try {
      const { intolerances: list } = await apiFetch<{ intolerances: Intolerance[] }>(
        "/api/public/food-intolerances",
      );
      setIntolerances(list);
    } catch {
      /* The rest of the profile remains usable without intolerance labels. */
    }
  }, [me]);

  useEffect(() => {
    void loadSupportingData();
  }, [loadSupportingData]);

  const operator = isOperator(me?.capabilities ?? []);

  useEffect(() => {
    if (!operator) return;
    fetchMyScanStats()
      .then(setMyStats)
      .catch(() => {
        /* Stats are a nice-to-have on this screen; keep the rest usable without them. */
      });
  }, [operator]);

  async function changeLanguage(nextLanguage: Lang) {
    if (nextLanguage === me?.language || savingLanguage) return;
    setSavingLanguage(true);
    setLanguageError(null);
    setLanguageRetry(nextLanguage);
    try {
      await apiFetch("/api/me", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ language: nextLanguage }),
      });
      await refetch();
      setLanguageRetry(null);
      void haptic("selection");
    } catch (cause) {
      setLanguageError(cause instanceof Error ? cause : new Error(t("accountLanguageError")));
    } finally {
      setSavingLanguage(false);
    }
  }

  async function endSession() {
    setSigningOut(true);
    setSignOutError(null);
    try {
      const { error: authError } = await signOut();
      if (authError) throw new Error(authError.message || t("signOutError"));
      // The roster is shared, event-wide data with no reason to survive a
      // session boundary — wipe it (and its encryption key) now rather than
      // leaving it cached until the next signed-in device sync. The offline
      // scan queue is deliberately left alone: it's per-user encrypted and
      // reappears, still decryptable, if this same person signs back in.
      await wipeAttendanceRoster();
    } catch (cause) {
      setSignOutError(cause instanceof Error ? cause : new Error(t("signOutError")));
      setSigningOut(false);
    }
  }

  function confirmSignOut() {
    Alert.alert(t("signOutConfirmTitle"), t("signOutConfirmBody"), [
      { text: t("cancel"), style: "cancel" },
      { text: t("signOut"), style: "destructive", onPress: () => void endSession() },
    ]);
  }

  async function clearCache() {
    setClearingCache(true);
    setStorageError(null);
    try {
      await clearAllCaches(operator);
      await loadStorageUsage();
    } catch (cause) {
      setStorageError(cause instanceof Error ? cause : new Error(t("storageClearError")));
    } finally {
      setClearingCache(false);
    }
  }

  function confirmClearCache() {
    Alert.alert(t("storageClearConfirmTitle"), t("storageClearConfirmBody"), [
      { text: t("cancel"), style: "cancel" },
      { text: t("storageClearAction"), style: "destructive", onPress: () => void clearCache() },
    ]);
  }

  async function finishLocalAccountClosure(
    userId: number,
    action: AccountRemovalProgress["action"],
    pendingMessage?: string,
    progress?: Parameters<typeof saveAccountRemovalProgress>[0],
  ): Promise<void> {
    if (pendingMessage) {
      await new Promise<void>((resolve) => {
        Alert.alert(t("accountAnonymizePendingTitle"), pendingMessage, [
          { text: t("confirm"), onPress: () => resolve() },
        ]);
      });
    }
    // The server revokes access before it touches object storage. Local
    // cleanup is best-effort, but sign-out must still run if a SQLite/Secure
    // Store operation fails so a closed account cannot keep an authenticated
    // session on this device.
    let localCleanupFailed = false;
    try {
      await clearAccountData(userId);
    } catch {
      localCleanupFailed = true;
    }
    const savedProgress =
      progress ??
      (localCleanupFailed ? { action, status: "device_cleanup_pending" as const } : null);
    if (savedProgress) await saveAccountRemovalProgress(savedProgress);
    else await clearAccountRemovalProgress();
    if (localCleanupFailed && !pendingMessage) {
      Alert.alert(t("accountRemovalDeviceCleanupPending"));
    }
    await signOut().catch(() => undefined);
  }

  async function handleRemovalFailure(
    cause: unknown,
    userId: number,
    fallback: string,
    action: AccountRemovalProgress["action"],
  ): Promise<void> {
    // prepareAccountRemoval revokes sessions before private-object cleanup.
    // A 5xx can therefore mean the server has already committed closure even
    // though the response failed; clear local identity/cache data in that case
    // rather than leaving a closed account's PII on the device (H54).
    const serverMayHaveRevokedAccess =
      !(cause instanceof ApiError) ||
      cause.code === "removal_storage_pending" ||
      cause.status >= 500;
    if (serverMayHaveRevokedAccess) {
      await finishLocalAccountClosure(userId, action, undefined, { action, status: "processing" });
      setRemovalError(new Error(t("accountRemovalPending")));
      return;
    }
    setRemovalError(cause instanceof Error ? cause : new Error(fallback));
  }

  function handleRemovalPinFailure(cause: unknown, action: AccountRemovalPinAction): boolean {
    if (!(cause instanceof ApiError)) return false;
    if (cause.code === "removal_pin_invalid") {
      setRemovalPinError(t("accountRemovalPinInvalid"));
      return true;
    }
    if (cause.code === "removal_pin_expired" || cause.code === "removal_pin_required") {
      setRemovalPinAction(null);
      setRemovalPinError(null);
      setRemovalPinRequestAction(action);
      setRemovalPinRequestError(new Error(t("accountRemovalPinExpired")));
      return true;
    }
    return false;
  }

  async function deleteAccount(securityPin?: string) {
    if (!me) return;
    setDeletingAccount(true);
    setRemovalError(null);
    try {
      const result = await deleteOwnAccount(securityPin);
      const progress =
        result.status === "completed"
          ? undefined
          : { action: "delete" as const, status: result.status };
      await finishLocalAccountClosure(
        me.id,
        "delete",
        result.status === "pending_exit" ? t("accountRemovalPendingExit") : undefined,
        progress,
      );
    } catch (cause) {
      if (handleRemovalPinFailure(cause, "delete")) return;
      await handleRemovalFailure(cause, me.id, t("accountDeleteError"), "delete");
    } finally {
      setDeletingAccount(false);
    }
  }

  function confirmDeleteAccount() {
    const body = [
      t("accountDeleteConfirmBody"),
      ...(removalEligibility?.requiresVenueExit ? [t("accountRemovalExitRequired")] : []),
    ].join("\n\n");
    Alert.alert(t("accountDeleteConfirmTitle"), body, [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("accountDeleteAction"),
        style: "destructive",
        onPress: () => void beginRemoval("delete"),
      },
    ]);
  }

  async function anonymizeAccount(securityPin?: string) {
    if (!me) return;
    setDeletingAccount(true);
    setRemovalError(null);
    try {
      const result = await anonymizeOwnAccount(securityPin);
      const progress =
        result.status === "completed"
          ? undefined
          : { action: "anonymize" as const, status: result.status };
      await finishLocalAccountClosure(
        me.id,
        "anonymize",
        result.status === "pending_exit" ? t("accountAnonymizePendingExit") : undefined,
        progress,
      );
    } catch (cause) {
      if (handleRemovalPinFailure(cause, "anonymize")) return;
      await handleRemovalFailure(cause, me.id, t("accountAnonymizeError"), "anonymize");
    } finally {
      setDeletingAccount(false);
    }
  }

  function confirmAnonymizeAccount() {
    Alert.alert(t("accountAnonymizeConfirmTitle"), t("accountAnonymizeConfirmBody"), [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("accountPrivacyPolicy"),
        onPress: () => void Linking.openURL(`${EVENT_WEBSITE_URL}/privacy`),
      },
      {
        text: t("accountAnonymizeAction"),
        style: "destructive",
        onPress: () => void beginRemoval("anonymize"),
      },
    ]);
  }

  async function beginRemoval(action: AccountRemovalPinAction): Promise<void> {
    setRemovalPinRequestAction(action);
    setRemovalPinRequestError(null);
    if (!removalEligibility?.securityPinRequired) {
      setRemovalPinRequestAction(null);
      setRemovalPinStatic(false);
      if (action === "delete") await deleteAccount();
      else await anonymizeAccount();
      return;
    }

    setRequestingRemovalPin(true);
    try {
      const result = await requestAccountRemovalPin();
      if (result.status === "not_required") {
        setRemovalPinRequestAction(null);
        setRemovalPinStatic(false);
        if (action === "delete") await deleteAccount();
        else await anonymizeAccount();
        return;
      }
      setRemovalPinRequestAction(null);
      setRemovalPinError(null);
      setRemovalPinStatic(result.status === "static");
      setRemovalPinAction(action);
    } catch (cause) {
      setRemovalPinRequestError(
        cause instanceof Error ? cause : new Error(t("accountRemovalLoadError")),
      );
    } finally {
      setRequestingRemovalPin(false);
    }
  }

  async function submitRemovalPin(pin: string): Promise<void> {
    if (removalPinAction === "delete") await deleteAccount(pin);
    else if (removalPinAction === "anonymize") await anonymizeAccount(pin);
  }

  function cancelRemovalPin() {
    if (deletingAccount) return;
    setRemovalPinAction(null);
    setRemovalPinStatic(false);
    setRemovalPinError(null);
  }

  if (loading && !me) return <RequestFeedback loading />;
  if (!me) return <RequestFeedback error={error} onRetry={() => void refetch()} />;

  const fullName = [me.name, me.surname].filter(Boolean).join(" ") || me.email;
  const initials =
    [me.name, me.surname]
      .filter(Boolean)
      .map((part) => part?.[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || me.email[0].toUpperCase();
  const dietaryLabels = me.foodIntolerances
    .map((id) => intolerances.find((item) => item.id === id)?.label[language] ?? String(id))
    .join(", ");

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          gap: 20,
          padding: 16,
          paddingBottom: Math.max(32, tabBarBottomInset + 16),
          paddingTop: 16 + androidTopInset,
        }}
      >
        {error ? <RequestFeedback error={error} onRetry={() => void refetch()} /> : null}
        {signOutError ? (
          <RequestFeedback
            error={signOutError}
            message={t("signOutError")}
            onRetry={() => void endSession()}
            retrying={signingOut}
          />
        ) : null}
        {languageError ? (
          <RequestFeedback
            error={languageError}
            message={t("accountLanguageError")}
            onRetry={languageRetry ? () => void changeLanguage(languageRetry) : undefined}
            retrying={savingLanguage}
          />
        ) : null}
        {storageError ? (
          <RequestFeedback
            error={storageError}
            message={t("storageClearError")}
            onRetry={confirmClearCache}
            retrying={clearingCache}
          />
        ) : null}

        <View style={{ alignItems: "center", gap: 10, paddingVertical: 10 }}>
          <View
            style={{
              alignItems: "center",
              backgroundColor: colors.accent,
              borderRadius: 42,
              height: 84,
              justifyContent: "center",
              width: 84,
            }}
          >
            <Text selectable style={{ color: colors.accentText, fontSize: 30, fontWeight: "700" }}>
              {initials}
            </Text>
          </View>
          <View style={{ alignItems: "center", gap: 5 }}>
            <Text
              selectable
              style={{ color: colors.label, fontSize: 23, fontWeight: "700", textAlign: "center" }}
            >
              {fullName}
            </Text>
            <Text selectable style={{ color: colors.secondaryLabel, fontSize: 15 }}>
              {roleLabel(me.role, t)}
            </Text>
            <StatusPill tone={me.badgeId ? "success" : "neutral"} style={{ alignSelf: "center" }}>
              {me.badgeId ? t("accountAccredited") : t("accountNotAccredited")}
            </StatusPill>
          </View>
        </View>

        <Section title={t("accountProfile")}>
          <InfoRow label={t("accountName")} value={fullName} icon="person" />
          <Separator inset={48} />
          <MenuView
            actions={LANGUAGES.map(
              (lang): MenuAction => ({
                id: lang,
                title: languageName(lang),
                state: lang === me.language ? "on" : "off",
                attributes: savingLanguage ? { disabled: true } : undefined,
              }),
            )}
            onPressAction={({ nativeEvent }) => void changeLanguage(nativeEvent.event as Lang)}
          >
            <View
              accessible
              accessibilityLabel={t("accountLanguage")}
              accessibilityRole="button"
              accessibilityState={{ disabled: savingLanguage, busy: savingLanguage }}
            >
              <InfoRow
                label={t("accountLanguage")}
                value={languageName(me.language)}
                icon="globe"
                accessoryIcon="chevron.down"
              />
            </View>
          </MenuView>
          <Separator inset={48} />
          <InfoRow
            label={t("accountShirtSize")}
            value={me.shirtSize || t("accountNotSet")}
            icon="tshirt"
          />
        </Section>

        <Section title={t("accountContact")}>
          <InfoRow
            label={t("accountEmail")}
            value={me.email}
            icon="envelope"
            accessoryIcon={
              me.emailVerified ? "checkmark.seal.fill" : "exclamationmark.triangle.fill"
            }
            accessoryColor={me.emailVerified ? colors.success : colors.warning}
            accessoryLabel={me.emailVerified ? t("accountVerified") : t("accountNotVerified")}
          />
          {me.secondaryEmail ? (
            <>
              <Separator inset={48} />
              <InfoRow
                label={t("accountSecondaryEmail")}
                value={me.secondaryEmail}
                icon="envelope.badge"
                accessoryIcon={
                  me.secondaryEmailVerified
                    ? "checkmark.seal.fill"
                    : "exclamationmark.triangle.fill"
                }
                accessoryColor={me.secondaryEmailVerified ? colors.success : colors.warning}
                accessoryLabel={
                  me.secondaryEmailVerified ? t("accountVerified") : t("accountNotVerified")
                }
              />
            </>
          ) : null}
        </Section>

        <Section title={t("accountEventDetails")}>
          <InfoRow
            label={t("accountBadge")}
            value={me.badgeId ?? t("accountNoBadge")}
            icon="key.card"
          />
          <Separator inset={48} />
          <InfoRow
            label={t("accountFoodIntolerances")}
            value={dietaryLabels || t("accountNoneDeclared")}
            icon="fork.knife"
          />
          {me.foodIntoleranceNotes ? (
            <>
              <Separator inset={48} />
              <View style={{ gap: 5, padding: 16 }}>
                <Text selectable style={{ color: colors.secondaryLabel, fontSize: 13 }}>
                  {t("accountDietaryNotes")}
                </Text>
                <Text selectable style={{ color: colors.label, fontSize: 16, lineHeight: 22 }}>
                  {me.foodIntoleranceNotes}
                </Text>
              </View>
            </>
          ) : null}
        </Section>

        {operator ? (
          <Section title={t("myStatsTitle")}>
            <InfoRow
              label={t("myStatsAccreditation")}
              value={myStats ? String(myStats.accreditationCount) : "—"}
              icon="person.badge.key.fill"
            />
            <Separator inset={48} />
            <InfoRow
              label={t("myStatsPresence")}
              value={myStats ? String(myStats.presenceCount) : "—"}
              icon="door.left.hand.open"
            />
            <Separator inset={48} />
            <InfoRow
              label={t("myStatsActivity")}
              value={myStats ? String(myStats.activityCount) : "—"}
              icon="list.bullet.rectangle"
            />
            <Separator inset={48} />
            <ActionButton
              label={t("scannerSeeHistory")}
              icon="clock.arrow.circlepath"
              onPress={() => router.push(SCAN_LOG_ROUTES.account)}
            />
          </Section>
        ) : null}

        <Section title={t("storageTitle")} footer={t("storageFooter")}>
          <InfoRow
            label={t("storageOfflineData")}
            value={storageUsage ? formatBytes(storageUsage.offlineDataBytes) : "—"}
            icon="arrow.down.circle"
          />
          <Separator inset={48} />
          <InfoRow
            label={t("storageDownloadedFiles")}
            value={storageUsage ? formatBytes(storageUsage.downloadedFilesBytes) : "—"}
            icon="doc"
          />
          <Separator inset={48} />
          <InfoRow
            label={t("storageTotal")}
            value={storageUsage ? formatBytes(storageUsage.totalBytes) : "—"}
            icon="internaldrive.fill"
          />
          <Separator />
          <ActionButton
            label={t("storageClearAction")}
            icon="trash"
            destructive
            busy={clearingCache}
            onPress={confirmClearCache}
          />
        </Section>

        <Section title={t("sessionTitle")} footer={t("sessionActive", { email: me.email })}>
          <ActionButton
            label={t("refreshAccount")}
            icon="arrow.clockwise"
            busy={loading}
            onPress={() => void refetch()}
          />
          <Separator />
          <ActionButton
            label={t("signOut")}
            icon="rectangle.portrait.and.arrow.right"
            destructive
            busy={signingOut}
            onPress={confirmSignOut}
          />
        </Section>

        <Section title={t("accountLegalTitle")}>
          <ActionButton
            label={t("accountPrivacyPolicy")}
            icon="hand.raised"
            onPress={() => void Linking.openURL(`${EVENT_WEBSITE_URL}/privacy`)}
          />
          <Separator />
          <ActionButton
            label={t("accountTerms")}
            icon="doc.text"
            onPress={() => void Linking.openURL(`${EVENT_WEBSITE_URL}/terms`)}
          />
        </Section>

        <Section title={t("accountDangerZone")}>
          <ActionButton
            label={dangerZoneOpen ? t("accountHideDangerZone") : t("accountShowDangerZone")}
            icon={dangerZoneOpen ? "chevron.up" : "chevron.down"}
            onPress={() => setDangerZoneOpen((open) => !open)}
          />
          {dangerZoneOpen ? (
            <>
              <Separator />
              {removalLoading ? (
                <View style={{ padding: 16 }}>
                  <RequestFeedback loading />
                </View>
              ) : removalError ? (
                <View style={{ padding: 16 }}>
                  <RequestFeedback
                    error={removalError}
                    message={
                      removalEligibility?.action === "anonymize"
                        ? t("accountAnonymizeError")
                        : t("accountDeleteError")
                    }
                    onRetry={() => void loadRemovalEligibility()}
                  />
                </View>
              ) : removalEligibility === null ? null : removalEligibility.action === "delete" ? (
                <View style={{ gap: 12, padding: 16 }}>
                  {removalPinRequestError ? (
                    <RequestFeedback
                      error={removalPinRequestError}
                      message={removalPinRequestError.message}
                      onRetry={
                        removalPinRequestAction
                          ? () => void beginRemoval(removalPinRequestAction)
                          : undefined
                      }
                      retrying={requestingRemovalPin}
                    />
                  ) : null}
                  <Text
                    selectable
                    style={{ color: colors.secondaryLabel, fontSize: 14, lineHeight: 20 }}
                  >
                    {t("accountDeleteDescription")}
                  </Text>
                  {removalEligibility.requiresVenueExit ? (
                    <Text
                      selectable
                      accessibilityLiveRegion="polite"
                      style={{ color: colors.warning, fontSize: 14, lineHeight: 20 }}
                    >
                      {t("accountRemovalExitRequired")}
                    </Text>
                  ) : null}
                  {removalEligibility.integrityWarning ? (
                    <Text
                      selectable
                      accessibilityLiveRegion="polite"
                      style={{ color: colors.warning, fontSize: 14, lineHeight: 20 }}
                    >
                      {t("accountRemovalIntegrityWarning")}
                    </Text>
                  ) : null}
                  <ActionButton
                    label={t("accountDeleteAction")}
                    icon="trash"
                    destructive
                    busy={deletingAccount || requestingRemovalPin}
                    onPress={confirmDeleteAccount}
                  />
                </View>
              ) : (
                <View style={{ gap: 12, padding: 16 }}>
                  {removalPinRequestError ? (
                    <RequestFeedback
                      error={removalPinRequestError}
                      message={removalPinRequestError.message}
                      onRetry={
                        removalPinRequestAction
                          ? () => void beginRemoval(removalPinRequestAction)
                          : undefined
                      }
                      retrying={requestingRemovalPin}
                    />
                  ) : null}
                  <Text
                    selectable
                    accessibilityLiveRegion="polite"
                    style={{ color: colors.secondaryLabel, fontSize: 14, lineHeight: 20 }}
                  >
                    {t("accountAnonymizeDescription")}
                  </Text>
                  <Text
                    selectable
                    style={{ color: colors.secondaryLabel, fontSize: 14, lineHeight: 20 }}
                  >
                    {t("accountAnonymizeProofLoss")}
                  </Text>
                  {removalEligibility.activeEventConsequences ? (
                    <Text
                      selectable
                      accessibilityLiveRegion="polite"
                      style={{ color: colors.warning, fontSize: 14, lineHeight: 20 }}
                    >
                      {t("accountAnonymizeActiveEvent")}
                    </Text>
                  ) : null}
                  {removalEligibility.requiresVenueExit ? (
                    <Text
                      selectable
                      style={{ color: colors.warning, fontSize: 14, lineHeight: 20 }}
                    >
                      {t("accountAnonymizeExitRequired")}
                    </Text>
                  ) : null}
                  {removalEligibility.integrityWarning ? (
                    <Text
                      selectable
                      accessibilityLiveRegion="polite"
                      style={{ color: colors.warning, fontSize: 14, lineHeight: 20 }}
                    >
                      {t("accountRemovalIntegrityWarning")}
                    </Text>
                  ) : null}
                  <ActionButton
                    label={t("accountPrivacyPolicy")}
                    icon="hand.raised"
                    onPress={() => void Linking.openURL(`${EVENT_WEBSITE_URL}/privacy`)}
                  />
                  <ActionButton
                    label={t("accountAnonymizeAction")}
                    icon="person.crop.circle.badge.xmark"
                    destructive
                    busy={deletingAccount || requestingRemovalPin}
                    onPress={confirmAnonymizeAccount}
                  />
                </View>
              )}
            </>
          ) : null}
        </Section>
      </ScrollView>
      <AccountRemovalPinModal
        action={removalPinAction}
        busy={deletingAccount}
        error={removalPinError}
        staticPin={removalPinStatic}
        onCancel={cancelRemovalPin}
        onConfirm={(pin) => void submitRemovalPin(pin)}
        visible={removalPinAction !== null}
      />
      <AndroidStatusBarScrim />
    </View>
  );
}

function languageName(language: string) {
  return (
    ({ en: "English", es: "Español", gl: "Galego" } as Record<string, string>)[language] ?? language
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
      mentor: t("roleMentor"),
      participant: t("roleParticipant"),
      unassigned: t("roleUnassigned"),
    } as const
  )[role];
}
