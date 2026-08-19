import { CAPABILITIES } from "@hackos/shared/capabilities";
import { BlurView } from "expo-blur";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, Text, useColorScheme, View } from "react-native";
import Swipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DateTimeField } from "@/components/date-time-field";
import {
  ActionButton,
  AdaptiveBackButton,
  EmptyState,
  InfoRow,
  Section,
  Separator,
  StatusPill,
} from "@/components/native-ui";
import { PresenceSummaryLink } from "@/components/presence-summary-link";
import { QrCamera } from "@/components/QrCamera";
import { RequestFeedback } from "@/components/RequestFeedback";
import { SymbolView } from "@/components/symbol";
import { apiFetch } from "@/lib/api";
import { haptic } from "@/lib/haptics";
import { useLocale } from "@/lib/i18n";
import { useMeContext } from "@/lib/me-context";
import {
  enqueueLocalScan,
  findPersonById,
  findPersonByTicket,
  pendingScans,
} from "@/lib/scanner-db";
import type { ScannerPerson } from "@/lib/scanner-types";
import { useScannerSync } from "@/lib/use-scanner";
import { colors } from "@/theme/colors";

interface PersonDetails extends ScannerPerson {
  dni?: string | null;
  shirtSize?: string | null;
  currentBadge?: string | null;
  secondaryEmail?: string | null;
  secondaryEmailVerified?: boolean;
}

const CONTENT_PADDING = 16;
// The floating back button sits at `topInset + 12` with a 44pt diameter —
// the header's own text has to clear that whole row.
const BUTTON_ROW_HEIGHT = 60;
// Approximate height of the header's own name + email text, so the
// scrolling content below starts clear of it instead of underneath it.
const HEADER_TEXT_HEIGHT = 56;

/**
 * The action panel revealed by swiping the current-badge row left, matching
 * the OS notification center's swipe-to-clear gesture: the row slides as one
 * opaque layer (Swipeable's own transform on its child) to uncover these
 * buttons — they're at full opacity from the first pixel of drag, never
 * fading in separately — and the badge is only replaced/removed on the
 * deliberate follow-up tap, never by the swipe distance alone. This is the
 * last row in its section, so only its bottom-right corner is rounded to
 * match the section's own clip.
 */
function AccreditationRevealActions({
  onReplace,
  onDelete,
}: {
  onReplace: () => void;
  onDelete: () => void;
}) {
  const { t } = useLocale();
  return (
    <View style={{ flexDirection: "row", height: "100%" }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("personReplaceBadge")}
        onPress={() => {
          void haptic("light");
          onReplace();
        }}
        style={({ pressed }) => ({
          alignItems: "center",
          backgroundColor: colors.accent,
          gap: 4,
          height: "100%",
          justifyContent: "center",
          opacity: pressed ? 0.75 : 1,
          paddingHorizontal: 16,
        })}
      >
        <SymbolView name="qrcode.viewfinder" tintColor="white" size={16} accessible={false} />
        <Text style={{ color: "white", fontSize: 12, fontWeight: "700" }}>
          {t("personReplaceBadge")}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("personDeleteBadge")}
        onPress={() => {
          void haptic("warning");
          onDelete();
        }}
        style={({ pressed }) => ({
          alignItems: "center",
          backgroundColor: colors.destructive,
          gap: 4,
          height: "100%",
          justifyContent: "center",
          opacity: pressed ? 0.75 : 1,
          paddingHorizontal: 16,
        })}
      >
        <SymbolView name="trash.fill" tintColor="white" size={16} accessible={false} />
        <Text style={{ color: "white", fontSize: 12, fontWeight: "700" }}>
          {t("personDeleteBadge")}
        </Text>
      </Pressable>
    </View>
  );
}

type PersonLoadState = "loading" | "ready" | "missing" | "error";

export function PersonOperationsScreen() {
  const colorScheme = useColorScheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const userId = Number(id);
  const router = useRouter();
  const { language, t } = useLocale();
  const insets = useSafeAreaInsets();
  const { me } = useMeContext();
  const ownerUserId = me?.id;
  const sync = useScannerSync();
  const capabilities = new Set(me?.capabilities ?? []);
  const admin = capabilities.has("*");
  const canAccredit = admin || capabilities.has(CAPABILITIES.ACCREDIT_SCAN);
  const canPresence = admin || capabilities.has(CAPABILITIES.PRESENCE_SCAN);
  const [person, setPerson] = useState<PersonDetails | null>(null);
  const [loadState, setLoadState] = useState<PersonLoadState>("loading");
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [cameraAction, setCameraAction] = useState<"assign" | "replace" | null>(null);
  const [attendeeRole, setAttendeeRole] = useState<"participant" | "mentor" | null>(null);
  const [scannedAt, setScannedAt] = useState(new Date());
  const [busy, setBusy] = useState(false);
  // Server-side last door log, reported by the presence timeline below —
  // the local snapshot alone can lag behind manual edits or other devices.
  const [serverDoor, setServerDoor] = useState<{ kind: "in" | "out"; at: string } | null>(null);
  const onDoorState = useCallback(
    (state: { kind: "in" | "out"; at: string } | null) => setServerDoor(state),
    [],
  );
  const load = useCallback(async () => {
    setLoadError(null);
    setLoadState((current) => (current === "ready" ? current : "loading"));
    try {
      const local = await findPersonById(userId);
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
  }, [canAccredit, t, userId]);

  // Reload on every scanner sync: the register derives its direction from
  // the person's last door log, which door scans on other devices (or manual
  // timeline edits) change under us.
  useEffect(() => {
    void sync.lastSync;
    void load();
  }, [load, sync.lastSync]);

  async function saveBadge(nextBadge: string, attendeeRole?: "participant" | "mentor") {
    if (!person || ownerUserId === undefined) return;
    if (await findPersonByTicket(nextBadge)) {
      Alert.alert(t("personBadgeIsTicketTitle"), t("personBadgeIsTicketBody"));
      return;
    }
    const currentBadge = person.badgeId;
    const scanId = await enqueueLocalScan(
      currentBadge
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
          },
      ownerUserId,
    );
    void haptic("light");
    setCameraAction(null);
    setAttendeeRole(null);
    await sync.sync();
    const stored = (await pendingScans(ownerUserId)).find((scan) => scan.id === scanId);
    void haptic(
      stored?.status === "failed"
        ? "error"
        : stored?.status === "acknowledged"
          ? "success"
          : "light",
    );
    await load();
  }

  function beginBadgeAction() {
    if (!person) return;
    const nextAction = person.badgeId ? "replace" : "assign";
    if (!person.badgeId && person.role === "unassigned") {
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
    if (person.role === "participant" && !person.confirmed) {
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
        <AdaptiveBackButton top={insets.top + 12} onPress={() => router.back()} />
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
        <AdaptiveBackButton top={insets.top + 12} onPress={() => router.back()} />
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
        <AdaptiveBackButton top={insets.top + 12} onPress={() => router.back()} />
      </View>
    );
  }

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

  // Once a badge exists, its row lives at the bottom of Personal details
  // instead — this section is then only the unassigned-person action.
  const accreditationSection =
    canAccredit && !person.badgeId ? (
      <Section title={t("scannerAccreditation")}>
        <ActionButton
          icon="qrcode.viewfinder"
          label={t("personLinkBadge")}
          onPress={beginBadgeAction}
        />
      </Section>
    ) : null;

  // Door logging needs a badge: without one the register is hidden entirely
  // and assigning a badge becomes the profile's primary action instead.
  // The suggested direction (inferred from the last door signal) gets the
  // full labeled button; the other direction is still one tap away, as a
  // plain icon circle, for the rarer manual override.
  const otherDirection: "in" | "out" = direction === "in" ? "out" : "in";
  const directionTone = (dir: "in" | "out") => (dir === "in" ? colors.accent : colors.warning);
  const directionIcon = (dir: "in" | "out") =>
    dir === "in" ? "arrow.right.to.line" : "arrow.left.to.line";
  const directionLabel = (dir: "in" | "out") => (dir === "in" ? t("scannerIn") : t("scannerOut"));

  const registerButton = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={direction === "in" ? t("personRegisterEntry") : t("personRegisterExit")}
      accessibilityState={{ busy, disabled: busy }}
      disabled={busy}
      onPress={() => void registerPresence(direction)}
      style={({ pressed }) => ({
        alignItems: "center",
        backgroundColor: direction === "in" ? colors.accentSurface : colors.warningSurface,
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
        name={directionIcon(direction)}
        tintColor={directionTone(direction)}
        size={18}
        weight="semibold"
      />
      <Text style={{ color: directionTone(direction), fontSize: 17, fontWeight: "600" }}>
        {directionLabel(direction)}
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
      onPress={() => void registerPresence(otherDirection)}
      style={({ pressed }) => ({
        alignItems: "center",
        backgroundColor: colors.elevatedSurface,
        borderRadius: 25,
        height: 50,
        justifyContent: "center",
        opacity: busy ? 0.45 : pressed ? 0.6 : 1,
        width: 50,
      })}
    >
      <SymbolView
        name={directionIcon(otherDirection)}
        tintColor={colors.secondaryLabel}
        size={18}
        weight="semibold"
      />
    </Pressable>
  );

  const presenceRegisterSection =
    canPresence && person.badgeId ? (
      <Section title={t("personPresenceTitle")}>
        <View style={{ gap: 16, padding: 16 }}>
          <DateTimeField
            dateAccessibilityLabel={t("scannerDateField")}
            timeAccessibilityLabel={t("scannerTimeField")}
            maximumDate={new Date()}
            value={scannedAt}
            onChange={setScannedAt}
          />
          <View style={{ alignItems: "center", flexDirection: "row", gap: 10 }}>
            {registerButton}
            {otherDirectionButton}
          </View>
        </View>
      </Section>
    ) : null;

  // `app/(tabs)/scan/person/_layout.tsx` shows a real (transparent,
  // title-less) native nav bar on iOS for this screen, kept only so
  // `AdaptiveBackButton` can dock in the native toolbar on iPad widths. It's
  // invisible, but its frame still exists — `automatic` below lets iOS push
  // content (and the scroll indicator) below its real height for free,
  // instead of us guessing at a duplicate of that space ourselves.
  const headerHeight = insets.top + BUTTON_ROW_HEIGHT + HEADER_TEXT_HEIGHT;

  return (
    <>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        scrollIndicatorInsets={{ top: 60 }}
        contentContainerStyle={{
          gap: 22,
          paddingBottom: 40,
          paddingHorizontal: CONTENT_PADDING,
          // Only the extra name/email text below the native bar's own
          // (automatically-inset) space — not the full `headerHeight`,
          // which would double-count that native bar's height on top of it.
          paddingTop: HEADER_TEXT_HEIGHT + 10,
        }}
        style={{ backgroundColor: colors.background }}
      >
        {loadState === "error" && loadError ? (
          <RequestFeedback error={loadError} onRetry={() => void load()} />
        ) : null}

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
          <InfoRow label={t("personDni")} value={person.dni ?? "—"} icon="person.text.rectangle" />
          <Separator />
          <InfoRow label={t("personShirt")} value={person.shirtSize ?? "—"} icon="tshirt" />
          {person.intolerances.length > 0 ? (
            <>
              <Separator />
              <InfoRow
                label={t("personFoodRestrictions")}
                value={person.intolerances
                  .map((item) => item.label[language] ?? item.label.en ?? String(item.id))
                  .join(", ")}
                icon="exclamationmark.triangle.fill"
                valueStyle={{ color: colors.warning, fontWeight: "600" }}
              />
            </>
          ) : null}
          {person.foodIntoleranceNotes ? (
            <>
              <Separator />
              <InfoRow
                label={t("personFoodNotes")}
                value={person.foodIntoleranceNotes}
                icon="note.text"
              />
            </>
          ) : null}
          {canAccredit && person.badgeId ? (
            <>
              <Separator />
              <View
                style={{
                  borderBottomLeftRadius: 14,
                  borderBottomRightRadius: 14,
                  borderCurve: "continuous",
                  overflow: "hidden",
                }}
              >
                <Swipeable
                  renderRightActions={() => (
                    <AccreditationRevealActions
                      onReplace={beginBadgeAction}
                      onDelete={confirmRemoveBadge}
                    />
                  )}
                  rightThreshold={40}
                  overshootRight={false}
                >
                  <View style={{ backgroundColor: colors.surface }}>
                    <InfoRow
                      label={t("personCurrentBadge")}
                      value={person.badgeId}
                      icon="key.card"
                    />
                  </View>
                </Swipeable>
              </View>
            </>
          ) : null}
        </Section>

        {/* Personal details always lead; then the movement register (badge
            holders) or badge assignment (everyone else), then the rest. */}
        {person.badgeId ? presenceRegisterSection : null}
        {accreditationSection}

        {person.notes ? (
          <Section title={t("personImportantInfo")}>
            <InfoRow label={t("personNotes")} value={person.notes} icon="note.text" />
          </Section>
        ) : null}

        {canPresence ? (
          <PresenceSummaryLink
            accredited={Boolean(person.badgeId)}
            onDoorState={onDoorState}
            refreshKey={sync.lastSync ?? undefined}
            userId={userId}
          />
        ) : null}
      </ScrollView>

      <View
        pointerEvents="none"
        style={{
          height: headerHeight,
          left: 0,
          position: "absolute",
          right: 0,
          top: 0,
        }}
      >
        <BlurView
          intensity={9}
          tint={colorScheme === "dark" ? "dark" : "light"}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: headerHeight,
          }}
        />
        <View
          style={{
            left: 0,
            paddingHorizontal: CONTENT_PADDING,
            paddingTop: insets.top + BUTTON_ROW_HEIGHT,
            position: "absolute",
            right: 0,
            top: 0,
          }}
        >
          <Text
            selectable
            numberOfLines={1}
            style={{ color: colors.label, fontSize: 22, fontWeight: "800" }}
          >
            {fullName}
          </Text>
          {person.email ? (
            <Text
              selectable
              numberOfLines={1}
              style={{ color: colors.secondaryLabel, fontSize: 14, marginTop: 2 }}
            >
              {person.email}
            </Text>
          ) : null}
        </View>
      </View>

      <AdaptiveBackButton top={insets.top + 12} onPress={() => router.back()} />
      {!person.accepted ? (
        <View
          pointerEvents="none"
          style={{
            alignItems: "center",
            height: 44,
            justifyContent: "center",
            position: "absolute",
            right: 16,
            top: insets.top + 12,
          }}
        >
          <StatusPill tone="warning">{t("scannerNoAcceptedPlace")}</StatusPill>
        </View>
      ) : null}
    </>
  );
}
