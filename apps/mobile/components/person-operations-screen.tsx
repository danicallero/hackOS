import { CAPABILITIES } from "@hackos/shared/capabilities";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useState } from "react";
import { Alert, ScrollView, Text, useColorScheme, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  ActionButton,
  FloatingBackButton,
  InfoRow,
  Section,
  Separator,
  StatusPill,
} from "@/components/native-ui";
import { PresenceManagement } from "@/components/presence-management";
import { QrCamera } from "@/components/QrCamera";
import { apiFetch } from "@/lib/api";
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
  phone?: string | null;
  shirtSize?: string | null;
  currentBadge?: string | null;
}

export function PersonOperationsScreen() {
  useColorScheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const userId = Number(id);
  const router = useRouter();
  const { language, t } = useLocale();
  const insets = useSafeAreaInsets();
  const { me } = useMeContext();
  const sync = useScannerSync();
  const capabilities = new Set(me?.capabilities ?? []);
  const admin = capabilities.has("*");
  const canAccredit = admin || capabilities.has(CAPABILITIES.ACCREDIT_SCAN);
  const canPresence = admin || capabilities.has(CAPABILITIES.PRESENCE_SCAN);
  const [person, setPerson] = useState<PersonDetails | null>(null);
  const [cameraAction, setCameraAction] = useState<"assign" | "replace" | null>(null);
  const [scannedAt, setScannedAt] = useState(new Date());
  const [busy, setBusy] = useState(false);
  // Only one door movement is ever valid: an exit while the session is open,
  // an entry otherwise — so there's no direction to pick, just one button.
  const direction: "in" | "out" = person?.lastPresenceKind === "in" ? "out" : "in";

  const load = useCallback(async () => {
    const local = await findPersonById(userId);
    if (!local) return;
    setPerson(local);
    if (canAccredit) {
      try {
        const details = await apiFetch<PersonDetails>("/api/accreditation/lookup-user", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userId }),
        });
        setPerson({ ...local, ...details, badgeId: details.currentBadge ?? local.badgeId });
      } catch {
        /* The local person card remains available offline. */
      }
    }
  }, [canAccredit, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveBadge(nextBadge: string) {
    if (!person) return;
    if (await findPersonByTicket(nextBadge)) {
      Alert.alert(t("personBadgeIsTicketTitle"), t("personBadgeIsTicketBody"));
      return;
    }
    const currentBadge = person.badgeId;
    await enqueueLocalScan(
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
          },
    );
    setPerson({ ...person, badgeId: nextBadge });
    setCameraAction(null);
    await sync.sync();
    await load();
  }

  function beginBadgeAction() {
    if (!person) return;
    const nextAction = person.badgeId ? "replace" : "assign";
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
    if (!person?.badgeId) return;
    Alert.alert(t("personDeleteBadge"), t("personDeleteBadgeBody", { badge: person.badgeId }), [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("delete"),
        style: "destructive",
        onPress: () =>
          void (async () => {
            await enqueueLocalScan({
              kind: "badge_removal",
              userId,
              currentBadgeId: person.badgeId!,
              reason: t("badgeRemovalReason"),
            });
            setPerson({ ...person, badgeId: null });
            await sync.sync();
          })(),
      },
    ]);
  }

  async function registerPresence() {
    if (!person?.badgeId) return;
    setBusy(true);
    try {
      const scanId = await enqueueLocalScan({
        kind: "presence",
        badgeId: person.badgeId,
        direction,
        scannedAt: scannedAt.toISOString(),
      });
      await sync.sync();
      // The offline queue fails 4xx replays permanently (e.g. an entry while
      // a session is already open) — without this check the rejection is
      // invisible and the log just never appears.
      const stored = (await pendingScans()).find((scan) => scan.id === scanId);
      if (stored?.status === "failed") {
        Alert.alert(
          t("presenceScanRejectedTitle"),
          stored.lastError ?? t("presenceScanRejectedBody"),
        );
      } else {
        setPerson({
          ...person,
          lastPresenceKind: direction,
          lastPresenceAt: scannedAt.toISOString(),
        });
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
        onValue={(value) => void saveBadge(value.trim())}
      />
    );
  }

  if (!person) {
    return (
      <View
        style={{
          alignItems: "center",
          backgroundColor: colors.background,
          flex: 1,
          justifyContent: "center",
        }}
      >
        <Text style={{ color: colors.secondaryLabel }}>{t("personLoading")}</Text>
        <FloatingBackButton top={insets.top + 12} onPress={() => router.back()} />
      </View>
    );
  }

  const fullName =
    [person.name, person.surname].filter(Boolean).join(" ") ||
    t("personFallbackName", { id: String(userId) });

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
          icon="qrcode.viewfinder"
          label={t("personLinkBadge")}
          onPress={beginBadgeAction}
        />
      )}
    </Section>
  ) : null;

  // Door logging needs a badge: without one the register is hidden entirely
  // and assigning a badge becomes the profile's primary action instead.
  const presenceRegisterSection =
    canPresence && person.badgeId ? (
      <Section title={t("personPresenceTitle")} footer={t("personPresenceFooter")}>
        <View style={{ gap: 14, padding: 16 }}>
          {process.env.EXPO_OS === "android" ? (
            <>
              <DateTimePicker
                value={scannedAt}
                mode="date"
                maximumDate={new Date()}
                onChange={(_, date) => {
                  if (!date) return;
                  date.setHours(scannedAt.getHours(), scannedAt.getMinutes());
                  setScannedAt(date);
                }}
              />
              <DateTimePicker
                value={scannedAt}
                mode="time"
                onChange={(_, date) => {
                  if (!date) return;
                  const next = new Date(scannedAt);
                  next.setHours(date.getHours(), date.getMinutes());
                  setScannedAt(next);
                }}
              />
            </>
          ) : (
            <DateTimePicker
              value={scannedAt}
              mode="datetime"
              maximumDate={new Date()}
              onChange={(_, date) => date && setScannedAt(date)}
            />
          )}
        </View>
        <Separator />
        <ActionButton
          busy={busy}
          icon={direction === "in" ? "arrow.right.to.line" : "arrow.left.to.line"}
          label={direction === "in" ? t("personRegisterEntry") : t("personRegisterExit")}
          onPress={() => void registerPresence()}
        />
      </Section>
    ) : null;

  return (
    <>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          gap: 22,
          padding: 16,
          paddingBottom: 40,
          paddingTop: insets.top - 10,
        }}
        style={{ backgroundColor: colors.background }}
      >
        <View style={{ alignItems: "center", gap: 10, paddingVertical: 8 }}>
          <View
            style={{
              alignItems: "center",
              backgroundColor: colors.accentSurface,
              borderRadius: 999,
              height: 74,
              justifyContent: "center",
              width: 74,
            }}
          >
            <SymbolView name="person.fill" tintColor={colors.accent} size={34} />
          </View>
          <Text
            selectable
            style={{ color: colors.label, fontSize: 24, fontWeight: "700", textAlign: "center" }}
          >
            {fullName}
          </Text>
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <StatusPill tone={person.confirmed ? "success" : "warning"}>
              {person.confirmed
                ? t("scannerConfirmed")
                : person.accepted
                  ? t("scannerPlaceUnconfirmed")
                  : t("scannerNoAcceptedPlace")}
            </StatusPill>
          </View>
        </View>

        {person.badgeId ? presenceRegisterSection : accreditationSection}

        <Section title={t("personPersonalData")}>
          {person.email ? (
            <>
              <InfoRow label={t("emailLabel")} value={person.email} icon="envelope" />
              <Separator />
            </>
          ) : null}
          {person.dni ? (
            <>
              <InfoRow label={t("personDni")} value={person.dni} icon="person.text.rectangle" />
              <Separator />
            </>
          ) : null}
          {person.phone ? (
            <>
              <InfoRow label={t("personPhone")} value={person.phone} icon="phone" />
              <Separator />
            </>
          ) : null}
          <InfoRow label={t("personShirt")} value={person.shirtSize ?? "—"} icon="tshirt" />
        </Section>

        {person.badgeId ? accreditationSection : null}

        {person.intolerances.length > 0 || person.foodIntoleranceNotes || person.notes ? (
          <Section title={t("personImportantInfo")}>
            {person.intolerances.length > 0 || person.foodIntoleranceNotes ? (
              <>
                <InfoRow
                  label={t("personFoodRestrictions")}
                  value={[
                    person.intolerances
                      .map((item) => item.label[language] ?? item.label.en ?? String(item.id))
                      .join(", "),
                    person.foodIntoleranceNotes,
                  ]
                    .filter(Boolean)
                    .join("\n")}
                  icon="exclamationmark.triangle.fill"
                  valueStyle={{ color: colors.warning, fontWeight: "600" }}
                />
                {person.notes ? <Separator /> : null}
              </>
            ) : null}
            {person.notes ? (
              <InfoRow label={t("personNotes")} value={person.notes} icon="note.text" />
            ) : null}
          </Section>
        ) : null}

        {canPresence ? (
          <PresenceManagement refreshKey={sync.lastSync ?? undefined} userId={userId} />
        ) : null}
      </ScrollView>
      <FloatingBackButton top={insets.top + 12} onPress={() => router.back()} />
    </>
  );
}
