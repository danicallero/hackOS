import { useFocusEffect, useScrollToTop } from "expo-router";
import { Stack } from "expo-router/stack";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  useColorScheme,
  View,
} from "react-native";
import { ActionButton, AndroidStatusBarScrim } from "@/components/native-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { StaleDataBanner } from "@/components/stale-data-banner";
import { SymbolView } from "@/components/symbol";
import { ApiError } from "@/lib/api";
import { signOut } from "@/lib/auth-client";
import { type MessageKey, useLocale } from "@/lib/i18n";
import { useMeContext } from "@/lib/me-context";
import {
  type AccountRemovalProgress,
  clearAccountRemovalProgress,
  saveAccountRemovalProgress,
} from "@/lib/removal-progress";
import { useRouterTabBarScrollBottomInset } from "@/lib/router-tabs-inset";
import {
  type AccountRemovalEligibility,
  anonymizeOwnAccount,
  deleteOwnAccount,
  fetchAccountRemovalEligibility,
  requestAccountRemovalPin,
} from "@/lib/self-service";
import { clearAccountData } from "@/lib/storage-usage";
import { useRetryOnReconnect } from "@/lib/use-retry-on-reconnect";
import { colors } from "@/theme/colors";

type AccountRemovalAction = AccountRemovalEligibility["action"];
type AccountRemovalCredentialMode = "pin" | "password";
type RemovalScreen = "intro" | "verification";
type RemovalErrorKind = "load" | "action";

const REMOVAL_PIN_COOLDOWN_MS = 60_000;
const OTP_CELL_KEYS = ["one", "two", "three", "four", "five", "six"] as const;

interface RemovalPinChallenge {
  action: AccountRemovalAction;
  expiresAt: number | null;
  resendAvailableAt: number | null;
  staticPin: boolean;
}

function parsePinExpiry(value?: string): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function retryAfterMilliseconds(error: ApiError): number {
  const details = error.details;
  if (details && typeof details === "object" && "retryAfterSeconds" in details) {
    const seconds = (details as { retryAfterSeconds?: unknown }).retryAfterSeconds;
    if (typeof seconds === "number" && Number.isFinite(seconds)) {
      return Math.max(1, Math.ceil(seconds)) * 1_000;
    }
  }
  return REMOVAL_PIN_COOLDOWN_MS;
}

/** A focused, native two-screen account-deletion flow. */
export default function DeleteAccountScreen() {
  useColorScheme();
  const { t } = useLocale();
  const tabBarBottomInset = useRouterTabBarScrollBottomInset();
  const scrollRef = useRef<ScrollView>(null);
  useScrollToTop(scrollRef);
  const { me, loading, error, offline, staleSince, refetch } = useMeContext();
  const [screen, setScreen] = useState<RemovalScreen>("intro");
  const [retainedDataExpanded, setRetainedDataExpanded] = useState(false);
  const [removalEligibility, setRemovalEligibility] = useState<AccountRemovalEligibility | null>(
    null,
  );
  const [removalLoading, setRemovalLoading] = useState(true);
  const [removalError, setRemovalError] = useState<Error | null>(null);
  const [removalErrorKind, setRemovalErrorKind] = useState<RemovalErrorKind | null>(null);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [requestingRemovalPin, setRequestingRemovalPin] = useState(false);
  const [removalPinAction, setRemovalPinAction] = useState<AccountRemovalAction | null>(null);
  const [removalCredentialMode, setRemovalCredentialMode] =
    useState<AccountRemovalCredentialMode>("pin");
  const [credential, setCredential] = useState("");
  const [removalPinError, setRemovalPinError] = useState<string | null>(null);
  const [removalPinChallenge, setRemovalPinChallenge] = useState<RemovalPinChallenge | null>(null);
  const [removalPinClock, setRemovalPinClock] = useState(() => Date.now());
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  const loadRemovalEligibility = useCallback(async () => {
    setRemovalLoading(true);
    setRemovalError(null);
    setRemovalErrorKind(null);
    try {
      setRemovalEligibility(await fetchAccountRemovalEligibility());
    } catch {
      // A destructive, security-sensitive action must never keep showing a
      // previously confirmed outcome (e.g. "Full account deletion") once
      // that confirmation can no longer be verified against the server.
      setRemovalEligibility(null);
      setRemovalError(new Error(t("accountRemovalLoadError")));
      setRemovalErrorKind("load");
    } finally {
      setRemovalLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadRemovalEligibility();
  }, [loadRemovalEligibility]);

  // No connection when this screen first loaded — keep checking instead of
  // leaving the user stuck behind a manual Retry tap.
  useRetryOnReconnect(removalErrorKind === "load", loadRemovalEligibility);

  // Each visit starts with the explanation again. A PIN sent during a previous
  // visit must not silently turn the next visit into a confirmation screen.
  useFocusEffect(
    useCallback(() => {
      setScreen("intro");
      setRetainedDataExpanded(false);
      setRemovalPinAction(null);
      setRemovalCredentialMode("pin");
      setCredential("");
      setRemovalPinError(null);
      setRemovalPinChallenge(null);
    }, []),
  );

  useEffect(() => {
    if (!removalPinChallenge) return;
    setRemovalPinClock(Date.now());
    const interval = setInterval(() => setRemovalPinClock(Date.now()), 1_000);
    return () => clearInterval(interval);
  }, [removalPinChallenge]);

  useEffect(() => {
    const showEvent = process.env.EXPO_OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = process.env.EXPO_OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSubscription = Keyboard.addListener(showEvent, () => setKeyboardVisible(true));
    const hideSubscription = Keyboard.addListener(hideEvent, () => setKeyboardVisible(false));
    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  const resendInSeconds = removalPinChallenge?.resendAvailableAt
    ? Math.max(0, Math.ceil((removalPinChallenge.resendAvailableAt - removalPinClock) / 1_000))
    : 0;
  const resendBlocked =
    removalPinChallenge?.resendAvailableAt !== null &&
    removalPinChallenge?.resendAvailableAt !== undefined &&
    removalPinChallenge.resendAvailableAt > removalPinClock;

  async function finishLocalAccountClosure(
    userId: number,
    action: AccountRemovalProgress["action"],
    pendingMessage?: string,
    progress?: Parameters<typeof saveAccountRemovalProgress>[0],
  ): Promise<void> {
    if (pendingMessage) {
      await new Promise<void>((resolve) => {
        Alert.alert(t("accountRemovalPendingTitle"), pendingMessage, [
          { text: t("confirm"), onPress: () => resolve() },
        ]);
      });
    }

    // The server revokes access before it touches object storage. Local
    // cleanup is best-effort, but sign-out must still run if a local store
    // operation fails so a closed account cannot keep an authenticated session.
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
    // prepareAccountRemoval revokes sessions before private-object cleanup. A
    // 5xx can therefore mean closure has already committed even though the
    // response failed; clear local identity/cache data in that case.
    const serverMayHaveRevokedAccess =
      !(cause instanceof ApiError) ||
      cause.code === "removal_storage_pending" ||
      cause.status >= 500;
    if (serverMayHaveRevokedAccess) {
      await finishLocalAccountClosure(userId, action, undefined, { action, status: "processing" });
      setRemovalError(new Error(t("accountRemovalPending")));
      setRemovalErrorKind("action");
      return;
    }
    setRemovalError(cause instanceof Error ? cause : new Error(fallback));
    setRemovalErrorKind("action");
  }

  function showRequestFailure(action: AccountRemovalAction, keepVerificationScreen: boolean) {
    const now = Date.now();
    if (keepVerificationScreen) {
      setRemovalPinChallenge((current) =>
        current
          ? { ...current, action, resendAvailableAt: now, staticPin: false }
          : { action, expiresAt: null, resendAvailableAt: now, staticPin: false },
      );
      setRemovalPinClock(now);
      setRemovalPinAction(action);
      setRemovalCredentialMode("pin");
      setScreen("verification");
      setCredential("");
      setRemovalPinError(t("accountRemovalPinRequestError"));
      return;
    }
    setRemovalError(new Error(t("accountRemovalPinRequestError")));
    setRemovalErrorKind("action");
  }

  function handleRemovalPinFailure(
    cause: unknown,
    action: AccountRemovalAction,
    fromPinRequest = false,
    isResend = false,
  ): boolean {
    if (!(cause instanceof ApiError)) {
      if (fromPinRequest) showRequestFailure(action, isResend);
      return fromPinRequest;
    }

    if (fromPinRequest && cause.status === 429) {
      const now = Date.now();
      setRemovalPinChallenge((current) => ({
        action,
        expiresAt: current?.expiresAt ?? null,
        resendAvailableAt: now + retryAfterMilliseconds(cause),
        staticPin: false,
      }));
      setRemovalPinClock(now);
      setRemovalCredentialMode("pin");
      setRemovalPinAction(action);
      setScreen("verification");
      setCredential("");
      setRemovalPinError(t("accountRemovalPinRequestError"));
      return true;
    }

    if (cause.code === "removal_reauthentication_required") {
      setRemovalCredentialMode("password");
      setRemovalPinAction(action);
      setScreen("verification");
      setCredential("");
      setRemovalPinError(null);
      return true;
    }

    if (cause.code === "removal_reauthentication_invalid") {
      setRemovalCredentialMode("password");
      setRemovalPinAction(action);
      setScreen("verification");
      setCredential("");
      setRemovalPinError(t("accountRemovalPasswordInvalid"));
      return true;
    }

    if (cause.code === "removal_pin_invalid") {
      setRemovalPinAction(action);
      setScreen("verification");
      setCredential("");
      setRemovalPinError(t("accountRemovalPinInvalid"));
      return true;
    }

    if (cause.code === "removal_pin_expired" || cause.code === "removal_pin_required") {
      const now = Date.now();
      setRemovalPinChallenge({
        action,
        expiresAt: now,
        resendAvailableAt: now,
        staticPin: false,
      });
      setRemovalPinClock(now);
      setRemovalCredentialMode("pin");
      setRemovalPinAction(action);
      setScreen("verification");
      setCredential("");
      setRemovalPinError(
        t(
          cause.code === "removal_pin_expired"
            ? "accountRemovalPinExpired"
            : "accountRemovalPinRequired",
        ),
      );
      return true;
    }

    if (fromPinRequest) {
      showRequestFailure(action, isResend);
      return true;
    }
    return false;
  }

  async function removeAccount(
    action: AccountRemovalAction,
    securityPin?: string,
    reauthenticationPassword?: string,
  ): Promise<void> {
    if (!me) return;
    setDeletingAccount(true);
    setRemovalError(null);
    setRemovalErrorKind(null);
    try {
      const result =
        action === "delete"
          ? await deleteOwnAccount(securityPin, reauthenticationPassword)
          : await anonymizeOwnAccount(securityPin, reauthenticationPassword);
      const progress =
        result.status === "completed"
          ? undefined
          : { action, status: result.status as "pending_exit" | "processing" };
      await finishLocalAccountClosure(
        me.id,
        action,
        result.status === "pending_exit" ? t("accountRemovalPendingExit") : undefined,
        progress,
      );
    } catch (cause) {
      if (handleRemovalPinFailure(cause, action)) return;
      await handleRemovalFailure(cause, me.id, t("accountDeleteError"), action);
    } finally {
      setDeletingAccount(false);
    }
  }

  function showVerificationScreen(action: AccountRemovalAction) {
    setScreen("verification");
    setRemovalPinAction(action);
    setCredential("");
    setRemovalPinError(null);
    setRemovalError(null);
    setRemovalErrorKind(null);
  }

  async function continueWithoutPin(action: AccountRemovalAction): Promise<void> {
    setRemovalPinChallenge(null);
    setRemovalCredentialMode(removalEligibility?.reauthenticationRequired ? "password" : "pin");
    showVerificationScreen(action);
  }

  function openExistingChallenge(action: AccountRemovalAction): void {
    if (!removalPinChallenge) return;
    const expired =
      !removalPinChallenge.staticPin &&
      removalPinChallenge.expiresAt !== null &&
      removalPinChallenge.expiresAt <= Date.now();
    setRemovalPinChallenge((current) => (current ? { ...current, action } : current));
    setRemovalCredentialMode("pin");
    setRemovalPinAction(action);
    setScreen("verification");
    setCredential("");
    setRemovalPinError(expired ? t("accountRemovalPinExpired") : null);
  }

  async function beginRemoval(action: AccountRemovalAction): Promise<void> {
    if (!removalEligibility || deletingAccount || requestingRemovalPin) return;
    setRemovalError(null);
    setRemovalErrorKind(null);
    setRemovalPinError(null);
    const now = Date.now();
    const hasUsableChallenge =
      removalPinChallenge !== null &&
      (removalPinChallenge.expiresAt === null || removalPinChallenge.expiresAt > now);
    if (removalEligibility.securityPinRequired && hasUsableChallenge) {
      openExistingChallenge(action);
      return;
    }
    if (!removalEligibility.securityPinRequired) {
      await continueWithoutPin(action);
      return;
    }

    setRequestingRemovalPin(true);
    try {
      const result = await requestAccountRemovalPin();
      if (result.status === "not_required") {
        await continueWithoutPin(action);
        return;
      }
      const requestTime = Date.now();
      setRemovalPinChallenge({
        action,
        expiresAt: parsePinExpiry(result.expiresAt),
        resendAvailableAt: result.status === "sent" ? requestTime + REMOVAL_PIN_COOLDOWN_MS : null,
        staticPin: result.status === "static",
      });
      setRemovalPinClock(requestTime);
      setRemovalCredentialMode("pin");
      setRemovalPinAction(action);
      setCredential("");
      setScreen("verification");
    } catch (cause) {
      handleRemovalPinFailure(cause, action, true);
    } finally {
      setRequestingRemovalPin(false);
    }
  }

  async function resendRemovalCode(): Promise<void> {
    const action = removalPinAction ?? removalPinChallenge?.action;
    if (
      !action ||
      !removalEligibility?.securityPinRequired ||
      removalPinChallenge?.staticPin ||
      requestingRemovalPin ||
      resendBlocked
    ) {
      return;
    }

    setRequestingRemovalPin(true);
    setRemovalPinError(null);
    try {
      const result = await requestAccountRemovalPin();
      if (result.status === "not_required") {
        await continueWithoutPin(action);
        return;
      }
      const requestTime = Date.now();
      setRemovalPinChallenge({
        action,
        expiresAt: parsePinExpiry(result.expiresAt),
        resendAvailableAt: result.status === "sent" ? requestTime + REMOVAL_PIN_COOLDOWN_MS : null,
        staticPin: result.status === "static",
      });
      setRemovalPinClock(requestTime);
      setRemovalCredentialMode("pin");
      setRemovalPinAction(action);
      setCredential("");
      setRemovalPinError(null);
      setScreen("verification");
    } catch (cause) {
      handleRemovalPinFailure(cause, action, true, true);
    } finally {
      setRequestingRemovalPin(false);
    }
  }

  async function submitRemovalCredential(): Promise<void> {
    if (!removalPinAction || deletingAccount || requestingRemovalPin) return;
    if (removalCredentialMode === "password" && credential.trim().length === 0) {
      setRemovalPinError(t("accountRemovalPasswordRequired"));
      return;
    }
    if (removalCredentialMode === "pin" && removalPinChallenge && credential.length !== 6) {
      setRemovalPinError(t("accountRemovalPinInvalid"));
      return;
    }
    setRemovalPinError(null);
    if (removalCredentialMode === "password") {
      await removeAccount(removalPinAction, undefined, credential);
    } else {
      await removeAccount(removalPinAction, removalPinChallenge ? credential : undefined);
    }
  }

  function updateCredential(value: string) {
    setCredential(
      removalCredentialMode === "password"
        ? value.slice(0, 128)
        : value.replace(/\D/g, "").slice(0, 6),
    );
    setRemovalPinError(null);
    setRemovalError(null);
    setRemovalErrorKind(null);
  }

  if (loading && !me) return <RequestFeedback loading />;
  if (!me) return <RequestFeedback error={error} onRetry={() => void refetch()} />;

  // Deliberately `undefined` (not `false`) when eligibility hasn't been
  // confirmed by the server, so the outcome panel below stays hidden instead
  // of defaulting to "Full account deletion" as if that were a real answer.
  const isAnonymizedOutcome = removalEligibility
    ? removalEligibility.action === "anonymize"
    : undefined;
  const retainedFields = [
    t("accountRetainedAge"),
    t("accountRetainedGender"),
    t("accountRetainedUniversity"),
    t("accountRetainedDegree"),
    t("accountRetainedGraduationYear"),
    t("accountRetainedOriginCity"),
    t("accountRetainedPresenceTime"),
  ];
  const screenTitle =
    screen === "intro" ? t("accountDeleteSection") : t("accountDeleteConfirmTitle");
  const credentialLabel =
    removalCredentialMode === "password"
      ? t("accountRemovalPasswordLabel")
      : t("accountDeleteVerificationCodeLabel");
  const verificationDescription =
    removalCredentialMode === "password"
      ? t("accountRemovalPasswordDescription")
      : removalPinChallenge?.staticPin
        ? t("accountRemovalPinStaticDescription")
        : removalPinChallenge
          ? t("accountDeleteVerificationBody")
          : t("accountDeleteNoVerificationBody");
  const canSubmitCredential =
    removalCredentialMode === "password"
      ? credential.trim().length > 0
      : !removalPinChallenge || credential.length === 6;

  return (
    <>
      <Stack.Screen
        options={{
          headerLargeTitle: false,
          headerShadowVisible: false,
          headerShown: true,
          title: screenTitle,
        }}
      />
      <View style={{ backgroundColor: colors.background, flex: 1 }}>
        {screen === "intro" ? (
          <ScrollView
            ref={scrollRef}
            automaticallyAdjustKeyboardInsets
            contentInsetAdjustmentBehavior="automatic"
            contentContainerStyle={{
              gap: 28,
              padding: 20,
              paddingBottom: Math.max(36, tabBarBottomInset + 20),
            }}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            refreshControl={
              <RefreshControl
                refreshing={removalLoading && removalEligibility !== null}
                onRefresh={() => void loadRemovalEligibility()}
              />
            }
            style={{ flex: 1 }}
          >
            {offline ? (
              <StaleDataBanner updatedAt={staleSince} />
            ) : error ? (
              <RequestFeedback error={error} onRetry={() => void refetch()} />
            ) : null}
            <IntroScreen
              expanded={retainedDataExpanded}
              isAnonymizedOutcome={isAnonymizedOutcome}
              loading={removalLoading}
              eligibilityError={removalErrorKind === "load" ? removalError : null}
              actionError={removalErrorKind === "action" ? removalError : null}
              requiresVenueExit={removalEligibility?.requiresVenueExit ?? false}
              integrityWarning={removalEligibility?.integrityWarning ?? false}
              retainedFields={retainedFields}
              onContinue={() => void beginRemoval(removalEligibility?.action ?? "delete")}
              onToggleRetained={() => setRetainedDataExpanded((expanded) => !expanded)}
              disabled={!removalEligibility || removalLoading || removalErrorKind === "load"}
              busy={requestingRemovalPin || deletingAccount}
              t={t}
            />
          </ScrollView>
        ) : (
          <KeyboardAvoidingView
            behavior={process.env.EXPO_OS === "ios" ? "padding" : undefined}
            style={{ flex: 1 }}
          >
            <ScrollView
              automaticallyAdjustKeyboardInsets={false}
              contentContainerStyle={{
                alignItems: "center",
                paddingHorizontal: 20,
                paddingBottom: keyboardVisible ? 8 : Math.max(20, tabBarBottomInset + 20),
                paddingTop: keyboardVisible ? 12 : 20,
              }}
              contentInsetAdjustmentBehavior="automatic"
              keyboardDismissMode="none"
              keyboardShouldPersistTaps="always"
              scrollEnabled={false}
              style={{ flex: 1 }}
              testID="account-deletion-verification"
            >
              {offline ? (
                <StaleDataBanner updatedAt={staleSince} />
              ) : error ? (
                <RequestFeedback error={error} onRetry={() => void refetch()} />
              ) : null}
              <View style={{ maxWidth: 520, width: "100%" }}>
                <VerificationScreen
                  credential={credential}
                  credentialLabel={credentialLabel}
                  description={verificationDescription}
                  error={removalPinError}
                  actionError={removalError}
                  busy={deletingAccount}
                  resendBusy={requestingRemovalPin}
                  resendInSeconds={resendInSeconds}
                  resendBlocked={resendBlocked}
                  canSubmit={canSubmitCredential}
                  keyboardVisible={keyboardVisible}
                  passwordMode={removalCredentialMode === "password"}
                  hasChallenge={Boolean(removalPinChallenge)}
                  onChangeCredential={updateCredential}
                  onSubmit={() => void submitRemovalCredential()}
                  onResend={() => void resendRemovalCode()}
                  t={t}
                />
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        )}
        <AndroidStatusBarScrim />
      </View>
    </>
  );
}

function IntroScreen({
  expanded,
  isAnonymizedOutcome,
  loading,
  eligibilityError,
  actionError,
  requiresVenueExit,
  integrityWarning,
  retainedFields,
  onContinue,
  onToggleRetained,
  disabled,
  busy,
  t,
}: {
  expanded: boolean;
  isAnonymizedOutcome: boolean | undefined;
  loading: boolean;
  eligibilityError: Error | null;
  actionError: Error | null;
  requiresVenueExit: boolean;
  integrityWarning: boolean;
  retainedFields: string[];
  onContinue: () => void;
  onToggleRetained: () => void;
  disabled: boolean;
  busy: boolean;
  t: (key: MessageKey, values?: Record<string, string>) => string;
}) {
  return (
    <View style={{ gap: 28 }}>
      <View style={{ gap: 12 }}>
        <Text selectable style={{ color: colors.label, fontSize: 17, lineHeight: 25 }}>
          {t("accountDeleteIntro")}
        </Text>
        {isAnonymizedOutcome !== undefined ? (
          <View
            style={{
              borderLeftColor: colors.separator,
              borderLeftWidth: 2,
              gap: 4,
              paddingLeft: 12,
            }}
          >
            <Text selectable style={{ color: colors.secondaryLabel, fontSize: 13, lineHeight: 18 }}>
              {t("accountDeleteOutcomeTitle")}
            </Text>
            <Text selectable style={{ color: colors.label, fontSize: 16, fontWeight: "600" }}>
              {t(
                isAnonymizedOutcome
                  ? "accountDeleteAnonymizedOutcomeTitle"
                  : "accountDeleteFullOutcomeTitle",
              )}
            </Text>
            <Text selectable style={{ color: colors.secondaryLabel, fontSize: 14, lineHeight: 20 }}>
              {t(
                isAnonymizedOutcome
                  ? "accountDeleteAnonymizedOutcomeDescription"
                  : "accountDeleteFullOutcomeDescription",
              )}
            </Text>
          </View>
        ) : null}
      </View>

      {loading ? <RequestFeedback loading /> : null}
      {eligibilityError ? <RequestFeedback error={eligibilityError} /> : null}
      {actionError ? <DestructiveNotice message={actionError.message} urgent /> : null}

      <View style={{ gap: 14 }}>
        <Text
          accessibilityRole="header"
          selectable
          style={{ color: colors.label, fontSize: 20, fontWeight: "700" }}
        >
          {t("accountDeleteWhatHappens")}
        </Text>
        <BulletList
          items={[
            t("accountDeleteIdentityConsequence"),
            t("accountDeleteParticipationConsequence"),
            t("accountDeleteDocumentationConsequence"),
          ]}
        />
        {requiresVenueExit ? (
          <DestructiveNotice compact message={t("accountDeleteVenueExitWarning")} />
        ) : null}
        {integrityWarning ? (
          <DestructiveNotice compact message={t("accountDeleteIntegrityWarning")} />
        ) : null}
      </View>

      <View style={{ gap: 12 }}>
        <Text
          accessibilityRole="header"
          selectable
          style={{ color: colors.label, fontSize: 18, fontWeight: "700" }}
        >
          {t("accountDeleteAnonymousDataTitle")}
        </Text>
        <Text selectable style={{ color: colors.secondaryLabel, fontSize: 15, lineHeight: 22 }}>
          {t("accountDeleteAnonymousDataDescription")}
        </Text>
        <Pressable
          accessibilityLabel={t(
            expanded ? "accountDeleteRetainedDisclosureHide" : "accountDeleteRetainedDisclosure",
          )}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          onPress={onToggleRetained}
          style={({ pressed }) => ({
            alignItems: "center",
            flexDirection: "row",
            gap: 8,
            minHeight: 44,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Text style={{ color: colors.accent, flex: 1, fontSize: 15, fontWeight: "600" }}>
            {t(
              expanded ? "accountDeleteRetainedDisclosureHide" : "accountDeleteRetainedDisclosure",
            )}
          </Text>
          <SymbolView
            accessible={false}
            name={expanded ? "chevron.up" : "chevron.down"}
            tintColor={colors.accent}
            size={17}
            weight="semibold"
          />
        </Pressable>
        {expanded ? <BulletList items={retainedFields} compact /> : null}
      </View>

      <View style={{ gap: 10 }}>
        <ActionButton
          busy={busy}
          destructive
          disabled={disabled}
          label={t("accountDeleteContinue")}
          onPress={onContinue}
          variant="filled"
        />
      </View>
    </View>
  );
}

function VerificationScreen({
  credential,
  credentialLabel,
  description,
  error,
  actionError,
  busy,
  resendBusy,
  resendInSeconds,
  resendBlocked,
  canSubmit,
  keyboardVisible,
  passwordMode,
  hasChallenge,
  onChangeCredential,
  onSubmit,
  onResend,
  t,
}: {
  credential: string;
  credentialLabel: string;
  description: string;
  error: string | null;
  actionError: Error | null;
  busy: boolean;
  resendBusy: boolean;
  resendInSeconds: number;
  resendBlocked: boolean;
  canSubmit: boolean;
  keyboardVisible: boolean;
  passwordMode: boolean;
  hasChallenge: boolean;
  onChangeCredential: (value: string) => void;
  onSubmit: () => void;
  onResend: () => void;
  t: (key: MessageKey, values?: Record<string, string>) => string;
}) {
  const [inputFocused, setInputFocused] = useState(false);

  return (
    <View
      style={{
        alignItems: passwordMode ? "stretch" : "center",
        gap: keyboardVisible ? 8 : 14,
      }}
    >
      <View
        style={{
          alignItems: passwordMode ? "stretch" : "center",
          gap: keyboardVisible ? 10 : 16,
          width: "100%",
        }}
      >
        <Text
          selectable
          style={{
            color: colors.label,
            fontSize: 16,
            lineHeight: keyboardVisible ? 22 : 24,
            maxWidth: 440,
            textAlign: passwordMode ? "left" : "center",
          }}
        >
          {description}
        </Text>
        {hasChallenge || passwordMode ? (
          <View style={{ alignItems: passwordMode ? "stretch" : "center", gap: 8, width: "100%" }}>
            <Text
              selectable
              style={{
                color: colors.label,
                fontSize: 15,
                fontWeight: "600",
                textAlign: passwordMode ? "left" : "center",
              }}
            >
              {credentialLabel}
            </Text>
            {passwordMode ? (
              <TextInput
                accessibilityLabel={credentialLabel}
                accessibilityHint={error ?? undefined}
                aria-invalid={Boolean(error)}
                autoCapitalize="none"
                autoComplete="password"
                autoCorrect={false}
                autoFocus
                editable={!busy && !resendBusy}
                maxLength={128}
                onBlur={() => setInputFocused(false)}
                onChangeText={onChangeCredential}
                onFocus={() => setInputFocused(true)}
                onSubmitEditing={onSubmit}
                returnKeyType="done"
                selectionColor={colors.accent}
                secureTextEntry
                style={{
                  backgroundColor: colors.elevatedSurface,
                  borderColor: error
                    ? colors.destructive
                    : inputFocused
                      ? colors.accent
                      : colors.separator,
                  borderCurve: "continuous",
                  borderRadius: 12,
                  borderWidth: inputFocused || error ? 2 : 1,
                  color: colors.label,
                  fontSize: 16,
                  minHeight: 56,
                  paddingHorizontal: 16,
                  paddingVertical: 12,
                }}
                textContentType="password"
                value={credential}
              />
            ) : (
              <OtpInput
                accessibilityHint={error ?? undefined}
                accessibilityLabel={credentialLabel}
                disabled={busy || resendBusy}
                error={Boolean(error)}
                focused={inputFocused}
                compact={keyboardVisible}
                onBlur={() => setInputFocused(false)}
                onChangeText={onChangeCredential}
                onFocus={() => setInputFocused(true)}
                onSubmitEditing={onSubmit}
                value={credential}
              />
            )}
            {error ? <DestructiveNotice message={error} urgent /> : null}
          </View>
        ) : null}
      </View>

      {!passwordMode && hasChallenge ? (
        <View style={{ alignItems: "center", width: "100%" }}>
          <Pressable
            accessibilityLabel={
              resendInSeconds > 0
                ? t("accountDeleteResendIn", { seconds: String(resendInSeconds) })
                : t("accountDeleteResendCode")
            }
            accessibilityRole="button"
            accessibilityState={{ busy: resendBusy, disabled: resendBusy || resendBlocked }}
            disabled={resendBusy || resendBlocked}
            onPress={onResend}
            style={({ pressed }) => ({
              alignItems: "center",
              flexDirection: "row",
              gap: 8,
              minHeight: keyboardVisible ? 36 : 44,
              opacity: resendBusy || resendBlocked ? 0.7 : pressed ? 0.6 : 1,
            })}
          >
            {resendBusy ? <ActivityIndicator color={colors.accent} size="small" /> : null}
            <Text
              style={{
                color: resendBusy || resendBlocked ? colors.tertiaryLabel : colors.accent,
                fontSize: 15,
                fontWeight: "600",
              }}
            >
              {resendInSeconds > 0
                ? t("accountDeleteResendIn", { seconds: String(resendInSeconds) })
                : t("accountDeleteResendCode")}
            </Text>
          </Pressable>
        </View>
      ) : null}

      <View style={{ gap: keyboardVisible ? 8 : 12, width: "100%" }}>
        {actionError ? <DestructiveNotice message={actionError.message} urgent /> : null}
        <DestructiveNotice compact dense={keyboardVisible} message={t("accountDeleteWarning")} />
        <ActionButton
          busy={busy}
          destructive
          disabled={busy || !canSubmit}
          label={t("accountDeleteAction")}
          onPress={onSubmit}
          variant="filled"
        />
      </View>
    </View>
  );
}

function OtpInput({
  accessibilityHint,
  accessibilityLabel,
  compact = false,
  disabled,
  error,
  focused,
  onBlur,
  onChangeText,
  onFocus,
  onSubmitEditing,
  value,
}: {
  accessibilityHint?: string;
  accessibilityLabel: string;
  compact?: boolean;
  disabled: boolean;
  error: boolean;
  focused: boolean;
  onBlur: () => void;
  onChangeText: (value: string) => void;
  onFocus: () => void;
  onSubmitEditing: () => void;
  value: string;
}) {
  return (
    <View style={{ height: compact ? 50 : 58, position: "relative", width: "100%" }}>
      <View
        pointerEvents="none"
        style={{
          alignItems: "center",
          flexDirection: "row",
          gap: compact ? 6 : 8,
          height: "100%",
          justifyContent: "center",
          width: "100%",
        }}
      >
        {OTP_CELL_KEYS.map((cellKey, index) => {
          const active = focused && index === Math.min(value.length, 5);
          return (
            <View
              key={cellKey}
              style={{
                alignItems: "center",
                backgroundColor: colors.elevatedSurface,
                borderColor: error ? colors.destructive : active ? colors.accent : colors.separator,
                borderCurve: "continuous",
                borderRadius: compact ? 11 : 12,
                borderWidth: error || active ? 2 : 1,
                flex: 1,
                justifyContent: "center",
                maxWidth: 52,
                minHeight: compact ? 48 : 56,
                minWidth: 0,
              }}
            >
              <Text
                style={{
                  color: colors.label,
                  fontSize: compact ? 22 : 24,
                  fontVariant: ["tabular-nums"],
                  fontWeight: "500",
                }}
              >
                {value[index] ?? ""}
              </Text>
            </View>
          );
        })}
      </View>
      <TextInput
        accessibilityHint={accessibilityHint}
        accessibilityLabel={accessibilityLabel}
        aria-invalid={error}
        autoCapitalize="none"
        autoComplete="sms-otp"
        autoCorrect={false}
        autoFocus
        caretHidden
        editable={!disabled}
        keyboardType="number-pad"
        maxLength={6}
        onBlur={onBlur}
        onChangeText={(nextValue) => onChangeText(nextValue.replace(/\D/g, "").slice(0, 6))}
        onFocus={onFocus}
        onSubmitEditing={onSubmitEditing}
        selectionColor="transparent"
        style={{
          bottom: 0,
          color: "transparent",
          fontSize: 16,
          left: 0,
          opacity: 0.02,
          padding: 0,
          position: "absolute",
          right: 0,
          top: 0,
        }}
        textContentType="oneTimeCode"
        value={value}
      />
    </View>
  );
}

function BulletList({ items, compact = false }: { items: string[]; compact?: boolean }) {
  return (
    <View style={{ gap: compact ? 6 : 10 }}>
      {items.map((item) => (
        <View key={item} style={{ alignItems: "flex-start", flexDirection: "row", gap: 10 }}>
          <Text
            selectable
            style={{ color: colors.secondaryLabel, fontSize: compact ? 14 : 16, lineHeight: 22 }}
          >
            •
          </Text>
          <Text
            selectable
            style={{
              color: compact ? colors.secondaryLabel : colors.label,
              flex: 1,
              fontSize: compact ? 14 : 16,
              lineHeight: compact ? 20 : 23,
            }}
          >
            {item}
          </Text>
        </View>
      ))}
    </View>
  );
}

function DestructiveNotice({
  compact = false,
  dense = false,
  message,
  urgent = false,
}: {
  compact?: boolean;
  dense?: boolean;
  message: string;
  urgent?: boolean;
}) {
  return (
    <View
      accessibilityLiveRegion={urgent ? "assertive" : "none"}
      accessibilityRole={urgent ? "alert" : undefined}
      style={{
        alignItems: "flex-start",
        borderBottomColor: compact ? colors.separator : undefined,
        borderBottomWidth: compact ? 0.5 : 0,
        borderTopColor: compact ? colors.separator : undefined,
        borderTopWidth: compact ? 0.5 : 0,
        flexDirection: "row",
        gap: 8,
        paddingVertical: dense ? 8 : compact ? 12 : 2,
      }}
    >
      <SymbolView
        accessible={false}
        name={compact ? "exclamationmark.triangle.fill" : "exclamationmark.circle.fill"}
        size={16}
        tintColor={colors.destructive}
        weight="semibold"
      />
      <Text
        selectable
        style={{
          color: colors.destructive,
          flex: 1,
          fontSize: dense ? 14 : compact ? 15 : 14,
          fontWeight: urgent ? "500" : "400",
          lineHeight: dense ? 19 : compact ? 21 : 20,
        }}
      >
        {message}
      </Text>
    </View>
  );
}
