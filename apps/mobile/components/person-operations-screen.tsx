import { CAPABILITIES } from "@hackos/shared/capabilities";
import { UI_TEST_IDS } from "@hackos/shared/ui-test-ids";
import {
  useFocusEffect,
  useLocalSearchParams,
  useNavigation,
  usePathname,
  useRouter,
  useScrollToTop,
} from "expo-router";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Alert, InteractionManager, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ActionButton,
  EmptyState,
  InfoRow,
  Section,
  Separator,
  StatusPill,
} from "@/components/native-ui";
import { formatMinutes, PresenceManagement } from "@/components/presence-management";
import { QrCamera } from "@/components/QrCamera";
import { RequestFeedback } from "@/components/RequestFeedback";
import { SymbolView } from "@/components/symbol";
import { ApiError, apiFetch } from "@/lib/api";
import { haptic } from "@/lib/haptics";
import { useLocale } from "@/lib/i18n";
import { useMeContext } from "@/lib/me-context";
import { transparentDetailHeaderOptions } from "@/lib/navigation";
import type { PresenceDivergence } from "@/lib/presence-timeline";
import { roleDisplayName } from "@/lib/role-filters";
import { useRouterTabBarScrollBottomInset } from "@/lib/router-tabs-inset";
import { enqueueLocalScan, findPersonById, pendingScans } from "@/lib/scanner-db";
import { submitScannerMutation } from "@/lib/scanner-sync";
import type { ScannerPerson, ScanPayload } from "@/lib/scanner-types";
import { usePresenceSummary } from "@/lib/use-presence-summary";
import { useScannerSync } from "@/lib/use-scanner";
import { colors } from "@/theme/colors";

interface PersonDetails extends ScannerPerson {
  shirtSize?: string | null;
  currentBadge?: string | null;
  secondaryEmail?: string | null;
  secondaryEmailVerified?: boolean;
}

const CONTENT_PADDING = 16;
// Transparent native headers do not reserve space on Android. Keep the first
// profile row below the status bar and native header there; iOS handles the
// same inset through `contentInsetAdjustmentBehavior="automatic"`.
const ANDROID_HEADER_CLEARANCE = 68;

type PersonLoadState = "loading" | "ready" | "missing" | "error";

/**
 * The badge shown in the top-right corner: capability holders, enterprise
 * judges, sponsors, and mentors just show their role (there's no "accepted
 * place" concept for them). Participants (and anyone with no visible role at
 * all) instead flag a missing accepted place or an unconfirmed one, and the
 * pill is omitted entirely once they've confirmed (H8 — badge_category
 * retired, no more fixed admin/staff/sponsor/mentor/judge role-name match).
 */
function personRolePill(
  person: ScannerPerson,
  t: ReturnType<typeof useLocale>["t"],
): { label: string; tone: "accent" | "warning" } | null {
  const normalizedRole = person.role?.toLocaleLowerCase() ?? null;
  if (person.hasCapabilities || person.isEnterpriseJudge) {
    return { label: roleDisplayName(person.role, t), tone: "accent" };
  }
  if (normalizedRole === "sponsor" || normalizedRole === "mentor") {
    return { label: person.role as string, tone: "accent" };
  }
  // Participant, a custom attendee role, or no visible role at all.
  if (!person.accepted) return { label: t("scannerNoAcceptedPlace"), tone: "warning" };
  return person.confirmed ? null : { label: t("scannerPlaceUnconfirmed"), tone: "warning" };
}

export function PersonOperationsScreen() {
  const { id, focusLogId, focusSource } = useLocalSearchParams<{
    id: string;
    focusLogId?: string;
    focusSource?: string;
  }>();
  const userId = Number(id);
  const router = useRouter();
  const navigation = useNavigation();
  const pathname = usePathname();
  const { language, t } = useLocale();
  const insets = useSafeAreaInsets();
  const tabBarBottomInset = useRouterTabBarScrollBottomInset();
  const scrollRef = useRef<ScrollView>(null);
  const scrollViewportRef = useRef<View>(null);
  const scrollOffsetRef = useRef(0);
  const autoScrolledFocusRef = useRef<string | null>(null);
  const [cameraAction, setCameraAction] = useState<"assign" | "replace" | null>(null);

  // These profile routes can be pushed from several independent stacks. Set
  // the same native options on the mounted leaf route as in each layout so a
  // parent stack cannot briefly expose `[id]` while the detail screen mounts.
  useLayoutEffect(() => {
    // QrCamera owns its own full-screen back control. On Android a transparent
    // native header still occupies the top 210px and wins hit-testing over
    // that control, making the first tap appear to do nothing. Remove the
    // header while the camera is open, then restore the profile chrome.
    navigation.setOptions(
      cameraAction
        ? { ...transparentDetailHeaderOptions, headerShown: false }
        : transparentDetailHeaderOptions,
    );
  }, [cameraAction, navigation]);

  useScrollToTop(scrollRef);
  const { me } = useMeContext();
  const ownerUserId = me?.id;
  const sync = useScannerSync();
  const capabilities = new Set(me?.capabilities ?? []);
  const admin = capabilities.has("*");
  const canAccredit = admin || capabilities.has(CAPABILITIES.ACCREDIT_SCAN);
  const canPresence = admin || capabilities.has(CAPABILITIES.PRESENCE_SCAN);
  const focusLogIdNumber = focusLogId ? Number(focusLogId) : NaN;
  const focusSignal: { id: number; source: "door" | "activity" } | undefined =
    Number.isInteger(focusLogIdNumber) && focusLogIdNumber > 0
      ? focusSource === "door"
        ? { id: focusLogIdNumber, source: "door" }
        : focusSource === "activity"
          ? { id: focusLogIdNumber, source: "activity" }
          : undefined
      : undefined;
  const focusSignalKey = focusSignal ? `${focusSignal.source}:${focusSignal.id}` : null;
  const scrollToFocusedSignal = useCallback(
    (target: View) => {
      if (!focusSignalKey || autoScrolledFocusRef.current === focusSignalKey) return;

      InteractionManager.runAfterInteractions(() => {
        if (autoScrolledFocusRef.current === focusSignalKey) return;
        target.measureInWindow((_targetX, targetY) => {
          scrollViewportRef.current?.measureInWindow((_viewportX, viewportY) => {
            const headerClearance =
              process.env.EXPO_OS === "ios" ? insets.top + 68 : insets.top + 16;
            const targetOffset = scrollOffsetRef.current + targetY - viewportY - headerClearance;
            scrollRef.current?.scrollTo({
              animated: true,
              y: Math.max(0, targetOffset),
            });
            autoScrolledFocusRef.current = focusSignalKey;
          });
        });
      });
    },
    [focusSignalKey, insets.top],
  );
  const [person, setPerson] = useState<PersonDetails | null>(null);
  const [loadState, setLoadState] = useState<PersonLoadState>("loading");
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [attendeeRole, setAttendeeRole] = useState<"participant" | "mentor" | null>(null);
  const [busy, setBusy] = useState(false);
  const badgeMutationInFlight = useRef(false);
  // Server-side last door log, reported by the presence timeline below —
  // the local snapshot alone can lag behind manual edits or other devices.
  const [serverDoor, setServerDoor] = useState<{ kind: "in" | "out"; at: string } | null>(null);
  const onDoorState = useCallback(
    (state: { kind: "in" | "out"; at: string } | null) => setServerDoor(state),
    [],
  );
  // Whether the door-only register's suggestion diverges from what activity
  // signals show (e.g. an activity opened a session with no door entry
  // behind it, or a past session timed out uncredited) — see
  // lib/presence-timeline.ts's detectPresenceDivergence for the exact rules.
  const [divergence, setDivergence] = useState<PresenceDivergence>({
    primaryOverride: null,
    secondary: null,
  });
  const { timeline, guaranteedMinutes } = usePresenceSummary({
    userId,
    refreshKey: sync.lastSync ?? undefined,
    onDoorState,
    onDivergence: setDivergence,
  });
  const load = useCallback(async () => {
    setLoadError(null);
    setLoadState((current) => (current === "ready" ? current : "loading"));
    try {
      // Once the network has answered, it is authoritative. Do not reject a
      // valid online profile merely because the disposable SQLite backup is
      // empty, locked, or unavailable.
      const local = sync.serverSnapshot
        ? (sync.serverSnapshot.people.find((candidate) => candidate.userId === userId) ?? null)
        : await findPersonById(userId);
      if (!local) {
        setPerson(null);
        setLoadState("missing");
        return;
      }

      if (canAccredit) {
        try {
          const details = await apiFetch<PersonDetails>("/api/accreditation/lookup-user", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ userId }),
          });
          // Single setPerson call with the fully-merged result: setting the
          // local-only snapshot first and the enriched one after causes a
          // visible flicker as dni/shirtSize/badge briefly disappear and
          // reappear on every periodic sync.
          setPerson({ ...local, ...details, badgeId: details.currentBadge ?? local.badgeId });
          setLoadState("ready");
          return;
        } catch {
          /* Fall through to the local-only card, e.g. while offline. */
        }
      }
      setPerson(local);
      setLoadState("ready");
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause : new Error(t("requestError")));
      setLoadState("error");
    }
  }, [canAccredit, sync.serverSnapshot, t, userId]);

  // Reload on every scanner sync: the register derives its direction from
  // the person's last door log, which door scans on other devices (or manual
  // timeline edits) change under us.
  useEffect(() => {
    void sync.lastSync;
    void load();
  }, [load, sync.lastSync]);

  // Also reload on focus: this screen stays mounted while "Add event" (a
  // separate pushed screen) saves a presence signal, so returning here
  // wouldn't otherwise pick up a just-changed badge/accreditation state.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function saveBadge(nextBadge: string, attendeeRole?: "participant" | "mentor") {
    if (!person || ownerUserId === undefined || !nextBadge || badgeMutationInFlight.current) return;
    badgeMutationInFlight.current = true;
    const currentBadge = person.badgeId;
    const payload: ScanPayload = currentBadge
      ? {
          kind: "badge_rotation",
          userId,
          currentBadgeId: currentBadge,
          newBadgeId: nextBadge,
          reason: t("badgeReplacementReason"),
        }
      : {
          kind: "accreditation_user",
          userId,
          badgeId: nextBadge,
          method: "manual",
          attendeeRole,
        };
    // Close the camera before doing any storage/network work. It prevents a
    // slow Android camera callback from submitting the same badge twice.
    setCameraAction(null);
    setAttendeeRole(null);
    try {
      const result = await submitScannerMutation(payload, ownerUserId);
      void haptic(result.state === "acknowledged" ? "success" : "light");
      // Refresh the authoritative snapshot after an online mutation. A local
      // cache failure is intentionally contained by useScannerSync, so it
      // cannot turn a successful server assignment into an error state.
      await sync.sync().catch(() => undefined);
      await load();
    } catch (cause) {
      void haptic("error");
      const message = cause instanceof Error ? cause.message : t("requestError");
      Alert.alert(
        cause instanceof ApiError ? t("scannerBusinessRejected") : t("requestError"),
        message,
      );
    } finally {
      badgeMutationInFlight.current = false;
    }
  }

  function beginBadgeAction() {
    if (!person) return;
    const nextAction = person.badgeId ? "replace" : "assign";
    if (!person.badgeId && person.role == null) {
      Alert.alert(t("accreditationChooseRole"), t("accreditationChooseRoleBody"), [
        { text: t("cancel"), style: "cancel" },
        {
          text: t("roleParticipant"),
          onPress: () => {
            setAttendeeRole("participant");
            setCameraAction(nextAction);
          },
        },
        {
          text: t("roleMentor"),
          onPress: () => {
            setAttendeeRole("mentor");
            setCameraAction(nextAction);
          },
        },
      ]);
      return;
    }
    if (person.role?.toLocaleLowerCase() === "participant" && !person.confirmed) {
      Alert.alert(
        person.accepted ? t("scannerPlaceUnconfirmed") : t("scannerNoAcceptedPlace"),
        person.accepted ? t("personUnconfirmedWarning") : t("personUnacceptedWarning"),
        [
          { text: t("cancel"), style: "cancel" },
          {
            text: t("continueAnyway"),
            style: "destructive",
            onPress: () => setCameraAction(nextAction),
          },
        ],
      );
      return;
    }
    setCameraAction(nextAction);
  }

  function confirmRemoveBadge() {
    if (!person?.badgeId || ownerUserId === undefined) return;
    Alert.alert(t("personDeleteBadge"), t("personDeleteBadgeBody", { badge: person.badgeId }), [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("delete"),
        style: "destructive",
        onPress: () =>
          void (async () => {
            const scanId = await enqueueLocalScan(
              {
                kind: "badge_removal",
                userId,
                currentBadgeId: person.badgeId!,
                reason: t("badgeRemovalReason"),
              },
              ownerUserId,
            );
            void haptic("light");
            await sync.sync();
            const stored = (await pendingScans(ownerUserId)).find((scan) => scan.id === scanId);
            void haptic(
              stored?.status === "failed"
                ? "error"
                : stored?.status === "acknowledged"
                  ? "warning"
                  : "light",
            );
            await load();
          })(),
      },
    ]);
  }

  async function registerPresence(direction: "in" | "out") {
    if (!person?.badgeId || ownerUserId === undefined) return;
    const scannedAt = new Date();
    setBusy(true);
    try {
      const scanId = await enqueueLocalScan(
        {
          kind: "presence",
          badgeId: person.badgeId,
          direction,
          scannedAt: scannedAt.toISOString(),
        },
        ownerUserId,
      );
      await sync.sync();
      // The offline queue fails 4xx replays permanently (e.g. an entry while
      // a session is already open) — without this check the rejection is
      // invisible and the log just never appears.
      const stored = (await pendingScans(ownerUserId)).find((scan) => scan.id === scanId);
      if (stored?.status === "failed") {
        void haptic("error");
        Alert.alert(
          t("presenceScanRejectedTitle"),
          stored.lastError ?? t("presenceScanRejectedBody"),
        );
      } else if (stored?.status === "acknowledged") {
        void haptic("success");
        setPerson({
          ...person,
          lastPresenceKind: direction,
          lastPresenceAt: scannedAt.toISOString(),
        });
      } else {
        void haptic("light");
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  // For the activity-open divergence only: the door-only scan endpoint
  // above would reject either half of this (no door session exists for it
  // to open or close), but the unrestricted signal endpoint — the same one
  // "Add event" already uses — has no such gate. Runs inline, right from
  // this screen, same as the normal register above; not offline-queued,
  // matching how the full editor's own saves already work.
  async function createPresenceSignal(kind: "in" | "out", occurredAt: Date) {
    if (ownerUserId === undefined) return;
    setBusy(true);
    try {
      const scanId = await enqueueLocalScan(
        { kind: "presence_signal", userId, direction: kind, occurredAt: occurredAt.toISOString() },
        ownerUserId,
      );
      await sync.sync();
      const stored = (await pendingScans(ownerUserId)).find((scan) => scan.id === scanId);
      if (stored?.status === "failed") {
        void haptic("error");
        Alert.alert(
          t("presenceScanRejectedTitle"),
          stored.lastError ?? t("presenceScanRejectedBody"),
        );
      } else if (stored?.status === "acknowledged") {
        void haptic("success");
      } else {
        void haptic("light");
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (cameraAction) {
    return (
      <QrCamera
        hint={cameraAction === "assign" ? t("personScanNewBadge") : t("personScanReplacementBadge")}
        onClose={() => setCameraAction(null)}
        onValue={(value) => void saveBadge(value.trim(), attendeeRole ?? undefined)}
      />
    );
  }

  if (loadState === "loading" && !person) {
    return (
      <View
        style={{
          backgroundColor: colors.background,
          flex: 1,
          justifyContent: "center",
        }}
      >
        <RequestFeedback loading />
      </View>
    );
  }

  if (loadState === "error" && !person && loadError) {
    return (
      <View
        style={{
          backgroundColor: colors.background,
          flex: 1,
          justifyContent: "center",
          padding: 16,
        }}
      >
        <RequestFeedback error={loadError} onRetry={() => void load()} />
      </View>
    );
  }

  if (loadState === "missing" || !person) {
    return (
      <View
        style={{
          backgroundColor: colors.background,
          flex: 1,
          justifyContent: "center",
        }}
      >
        <EmptyState
          icon="person.2"
          title={t("screenNotFoundTitle")}
          description={t("requestUnavailable")}
        />
      </View>
    );
  }

  const rolePill = personRolePill(person, t);

  const fullName =
    [person.name, person.surname].filter(Boolean).join(" ") ||
    t("personFallbackName", { id: String(userId) });

  // Only one door movement is ever valid, so only that button is shown.
  // Whichever door signal is newest wins: the server timeline (manual edits,
  // other devices) vs the local snapshot/queue (this device, maybe offline).
  const serverAt = serverDoor ? Date.parse(serverDoor.at) : Number.NEGATIVE_INFINITY;
  const localAt = person.lastPresenceAt
    ? Date.parse(person.lastPresenceAt)
    : Number.NEGATIVE_INFINITY;
  const lastDoorKind =
    serverAt >= localAt ? (serverDoor?.kind ?? person.lastPresenceKind) : person.lastPresenceKind;
  const direction: "in" | "out" = lastDoorKind === "in" ? "out" : "in";

  // Keep accreditation as an explicit section for both unassigned and
  // already-linked people. Hiding the linked state behind a swipe made the
  // Android profile look different from iOS and made the available action
  // easy to miss on a touch screen.
  const accreditationSection = canAccredit ? (
    <Section title={t("scannerAccreditation")}>
      <InfoRow
        label={t("personCurrentBadge")}
        value={person.badgeId ?? t("personUnassigned")}
        icon="key.card"
      />
      <Separator />
      {person.badgeId ? (
        <View style={{ flexDirection: "row" }}>
          <ActionButton
            icon="qrcode.viewfinder"
            label={t("personReplaceBadge")}
            onPress={beginBadgeAction}
            style={{ flex: 1 }}
          />
          <View style={{ backgroundColor: colors.separator, width: 0.5 }} />
          <ActionButton
            destructive
            icon="trash"
            label={t("personDeleteBadge")}
            onPress={confirmRemoveBadge}
            style={{ flex: 1 }}
          />
        </View>
      ) : (
        <ActionButton
          testID={UI_TEST_IDS.scanner.linkBadge}
          icon="qrcode.viewfinder"
          label={t("personLinkBadge")}
          onPress={beginBadgeAction}
        />
      )}
    </Section>
  ) : null;

  // Door logging needs a badge: without one the register is hidden entirely
  // and assigning a badge becomes the profile's primary action instead.
  // The suggested direction (inferred from the last door signal — or
  // overridden when an activity opened a session with no door entry behind
  // it, see PresenceDivergence) gets the full filled button; the other
  // direction is still one tap away, as a clearly labeled outline button.
  const effectiveDirection: "in" | "out" = divergence.primaryOverride ?? direction;
  const otherDirection: "in" | "out" = effectiveDirection === "in" ? "out" : "in";
  // The door-only scan endpoint can't represent either half of the
  // activity-open case (no door session exists for it to open or close) —
  // both buttons instead create the signal directly via createPresenceSignal.
  const isActivityOpenDivergence = divergence.primaryOverride !== null;
  const directionTone = (dir: "in" | "out") => (dir === "in" ? colors.accent : colors.warning);
  // The primary button fills with the matching tinted container, so its
  // label/icon need that container's own foreground — Material's base tone
  // on top of its own container is a pale-on-pale button on Android.
  const directionOnSurfaceTone = (dir: "in" | "out") =>
    dir === "in" ? colors.onAccentSurface : colors.onWarningSurface;
  const directionIcon = (dir: "in" | "out") =>
    dir === "in" ? "arrow.right.to.line" : "arrow.left.to.line";
  const directionLabel = (dir: "in" | "out") => (dir === "in" ? t("scannerIn") : t("scannerOut"));
  function openPresenceDraft(kind: "in" | "out", at: string) {
    const params = { id: String(userId), draftKind: kind, draftAt: at };
    if (pathname.includes("/activities/")) {
      router.push({ pathname: "/activities/person/presence/[id]", params });
    } else if (pathname.includes("/others/")) {
      router.push({ pathname: "/others/person/presence/[id]", params });
    } else {
      router.push({ pathname: "/scan/person/presence/[id]", params });
    }
  }

  // The suggested action fires immediately, right on this screen — an
  // activity-open session just can't go through the gated scan endpoint, so
  // it takes the unrestricted one instead, but neither case ever navigates
  // away to confirm a timestamp.
  function registerPrimary() {
    if (isActivityOpenDivergence) {
      void createPresenceSignal(effectiveDirection, new Date());
      return;
    }
    void registerPresence(effectiveDirection);
  }

  // The override direction always opens "Add event" pre-filled instead: it's
  // the less common, more deliberate action, so staff see (and can adjust)
  // the exact timestamp before it's committed, rather than firing blind.
  function registerOther() {
    const at =
      isActivityOpenDivergence && otherDirection === divergence.secondary?.kind
        ? divergence.secondary.at
        : new Date().toISOString();
    openPresenceDraft(otherDirection, at);
  }

  const registerButton = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        effectiveDirection === "in" ? t("personRegisterEntry") : t("personRegisterExit")
      }
      accessibilityState={{ busy, disabled: busy }}
      disabled={busy}
      onPress={registerPrimary}
      style={({ pressed }) => ({
        alignItems: "center",
        backgroundColor: effectiveDirection === "in" ? colors.accentSurface : colors.warningSurface,
        borderCurve: "continuous",
        borderRadius: 14,
        flex: 1,
        flexDirection: "row",
        gap: 8,
        height: 50,
        justifyContent: "center",
        opacity: busy ? 0.45 : pressed ? 0.6 : 1,
      })}
    >
      <SymbolView
        name={directionIcon(effectiveDirection)}
        tintColor={directionOnSurfaceTone(effectiveDirection)}
        size={18}
        weight="semibold"
      />
      <Text
        style={{
          color: directionOnSurfaceTone(effectiveDirection),
          fontSize: 17,
          fontWeight: "600",
        }}
      >
        {directionLabel(effectiveDirection)}
      </Text>
    </Pressable>
  );

  const otherDirectionButton = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        otherDirection === "in" ? t("personRegisterEntry") : t("personRegisterExit")
      }
      accessibilityState={{ busy, disabled: busy }}
      disabled={busy}
      onPress={registerOther}
      style={({ pressed }) => ({
        alignItems: "center",
        borderColor: directionTone(otherDirection),
        borderCurve: "continuous",
        borderRadius: 14,
        borderWidth: 1.5,
        flexDirection: "row",
        gap: 7,
        height: 50,
        justifyContent: "center",
        opacity: busy ? 0.45 : pressed ? 0.6 : 1,
        paddingHorizontal: 16,
      })}
    >
      <SymbolView
        name={directionIcon(otherDirection)}
        tintColor={directionTone(otherDirection)}
        size={16}
        weight="semibold"
      />
      <Text style={{ color: directionTone(otherDirection), fontSize: 15, fontWeight: "600" }}>
        {directionLabel(otherDirection)}
      </Text>
    </Pressable>
  );

  // Same warning row for both divergence cases: a past session that timed
  // out uncredited is offered as a tappable backdated fix; an activity-open
  // session (already handled by the register buttons above, which post
  // straight to the unrestricted signal endpoint for this case) is just the
  // static heads-up, no separate action needed.
  const divergenceWarning = isActivityOpenDivergence ? (
    <View style={{ alignItems: "center", flexDirection: "row", gap: 6 }}>
      <SymbolView
        name="exclamationmark.triangle.fill"
        tintColor={colors.warning}
        size={13}
        accessible={false}
      />
      <Text style={{ color: colors.warning, fontSize: 13, fontWeight: "600" }}>
        {t("presenceActivityOpenIndicator")}
      </Text>
    </View>
  ) : divergence.secondary?.reason === "invalid-window" ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("presenceFixStaleSession")}
      onPress={() => openPresenceDraft(divergence.secondary!.kind, divergence.secondary!.at)}
      style={({ pressed }) => ({
        alignItems: "center",
        flexDirection: "row",
        gap: 6,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <SymbolView
        name="exclamationmark.triangle.fill"
        tintColor={colors.warning}
        size={13}
        accessible={false}
      />
      <Text style={{ color: colors.warning, fontSize: 13, fontWeight: "600" }}>
        {t("presenceFixStaleSession")}
      </Text>
    </Pressable>
  ) : null;

  const presenceRegisterSection =
    canPresence && person.badgeId ? (
      <Section title={t("personPresenceTitle")}>
        <View style={{ gap: 16, padding: 16 }}>
          <View style={{ alignItems: "center", flexDirection: "row", gap: 10 }}>
            {registerButton}
            {otherDirectionButton}
          </View>
          {divergenceWarning}
        </View>
        <Separator />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("presenceGuaranteedHours")}
          onPress={() => {
            const params = { id: String(userId) };
            if (pathname.includes("/activities/")) {
              router.push({ pathname: "/activities/person/presence/[id]", params });
            } else if (pathname.includes("/others/")) {
              router.push({ pathname: "/others/person/presence/[id]", params });
            } else {
              router.push({ pathname: "/scan/person/presence/[id]", params });
            }
          }}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <InfoRow
            icon="checkmark.seal.fill"
            label={t("presenceGuaranteedHours")}
            value={timeline ? formatMinutes(guaranteedMinutes, t) : "—"}
            accessoryIcon="chevron.right"
            valueStyle={{ color: colors.success, fontVariant: ["tabular-nums"], fontWeight: "700" }}
          />
        </Pressable>
      </Section>
    ) : null;

  // The profile owns the visible heading while the transparent native header
  // owns the back action. Android has no `contentInsetAdjustmentBehavior` (an
  // iOS-only prop), so content there has to clear that header itself.
  const contentPaddingTop =
    process.env.EXPO_OS === "ios" ? 0 : insets.top + ANDROID_HEADER_CLEARANCE;

  return (
    <>
      <View ref={scrollViewportRef} style={{ backgroundColor: colors.background, flex: 1 }}>
        <ScrollView
          ref={scrollRef}
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{
            gap: 22,
            paddingBottom: Math.max(40, tabBarBottomInset + 16),
            paddingHorizontal: CONTENT_PADDING,
            paddingTop: contentPaddingTop,
          }}
          onScroll={(event) => {
            scrollOffsetRef.current = event.nativeEvent.contentOffset.y;
          }}
          scrollEventThrottle={16}
          style={{ backgroundColor: colors.background, flex: 1 }}
        >
          {loadState === "error" && loadError ? (
            <RequestFeedback error={loadError} onRetry={() => void load()} />
          ) : null}

          <View style={{ gap: 2 }}>
            <Text
              selectable
              accessibilityRole="header"
              numberOfLines={1}
              style={{ color: colors.label, fontSize: 28, fontWeight: "800" }}
            >
              {fullName}
            </Text>
            {person.email ? (
              <Text
                selectable
                numberOfLines={1}
                style={{ color: colors.secondaryLabel, fontSize: 15 }}
              >
                {person.email}
              </Text>
            ) : null}
          </View>

          <Section title={t("personPersonalData")}>
            {person.secondaryEmail ? (
              <>
                <InfoRow
                  label={t("personSecondaryEmail")}
                  value={person.secondaryEmail}
                  icon="envelope.badge"
                  accessoryIcon={
                    person.secondaryEmailVerified ? "checkmark.seal.fill" : "exclamationmark.circle"
                  }
                  accessoryColor={person.secondaryEmailVerified ? colors.success : colors.warning}
                  accessoryLabel={
                    person.secondaryEmailVerified
                      ? t("personSecondaryEmailVerified")
                      : t("personSecondaryEmailUnverified")
                  }
                />
                <Separator />
              </>
            ) : null}
            <InfoRow
              label={t("personDni")}
              value={person.dni ?? "—"}
              icon="person.text.rectangle"
            />
            <Separator />
            <InfoRow label={t("personShirt")} value={person.shirtSize ?? "—"} icon="tshirt" />
          </Section>

          {person.intolerances.length > 0 || person.foodIntoleranceNotes ? (
            <Section title={t("personDietaryTitle")}>
              {person.intolerances.length > 0 ? (
                <InfoRow
                  label={t("personFoodRestrictions")}
                  value={person.intolerances
                    .map((item) => item.label[language] ?? item.label.en ?? String(item.id))
                    .join(", ")}
                  icon="exclamationmark.triangle.fill"
                  valueStyle={{ color: colors.warning, fontWeight: "600" }}
                />
              ) : null}
              {person.intolerances.length > 0 ? <Separator /> : null}
              <InfoRow
                label={t("personFoodNotes")}
                value={person.foodIntoleranceNotes || "—"}
                icon="note.text"
              />
            </Section>
          ) : null}

          {person.notes ? (
            <Section>
              <InfoRow label={t("personNotes")} value={person.notes} icon="note.text" />
            </Section>
          ) : null}

          {/* Personal details always lead. A history deep-link expands the full
            editable timeline on this same profile and highlights the exact
            record; the normal profile keeps the compact register. */}
          {focusSignal ? (
            <PresenceManagement
              accredited={Boolean(person.badgeId)}
              badgeId={person.badgeId}
              focusSignal={focusSignal}
              onDoorState={onDoorState}
              onFocusedSignalLayout={scrollToFocusedSignal}
              refreshKey={sync.lastSync ?? undefined}
              userId={userId}
            />
          ) : person.badgeId ? (
            presenceRegisterSection
          ) : null}
          {accreditationSection}
        </ScrollView>
      </View>

      {rolePill ? (
        <View
          pointerEvents="none"
          style={{
            alignItems: "center",
            height: 44,
            justifyContent: "center",
            position: "absolute",
            right: 16,
            top: insets.top + 6,
          }}
        >
          <StatusPill tone={rolePill.tone}>{rolePill.label}</StatusPill>
        </View>
      ) : null}
    </>
  );
}
