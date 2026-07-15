import { CAPABILITIES } from "@hackos/shared/capabilities";
import DateTimePicker from "@react-native-community/datetimepicker";
import { GlassView } from "expo-glass-effect";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, Text, useColorScheme, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ActionButton, InfoRow, Section, Separator, StatusPill } from "@/components/native-ui";
import { QrCamera } from "@/components/QrCamera";
import { SegmentedControl } from "@/components/segmented-control";
import { apiFetch } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { useMeContext } from "@/lib/me-context";
import { enqueueLocalScan, findPersonById } from "@/lib/scanner-db";
import type { ScannerPerson } from "@/lib/scanner-types";
import { useScannerSync } from "@/lib/use-scanner";
import { colors } from "@/theme/colors";

interface PersonDetails extends ScannerPerson {
  dni?: string | null;
  phone?: string | null;
  shirtSize?: string | null;
  currentBadge?: string | null;
}

interface DoorScan {
  id: number;
  kind: string;
  location: string | null;
  scannedAt: string;
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
  const [history, setHistory] = useState<DoorScan[]>([]);
  const [cameraAction, setCameraAction] = useState<"assign" | "replace" | null>(null);
  const [direction, setDirection] = useState<"in" | "out">("in");
  const [scannedAt, setScannedAt] = useState(new Date());
  const [busy, setBusy] = useState(false);

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
    if (canPresence) {
      try {
        const result = await apiFetch<{ items: DoorScan[] }>(`/api/presence/logs/${userId}`);
        setHistory(result.items);
      } catch {
        /* Keep the last locally known state. */
      }
    }
  }, [canAccredit, canPresence, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveBadge(nextBadge: string) {
    if (!person) return;
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
    await enqueueLocalScan({
      kind: "presence",
      badgeId: person.badgeId,
      direction,
      scannedAt: scannedAt.toISOString(),
    });
    setPerson({ ...person, lastPresenceKind: direction, lastPresenceAt: scannedAt.toISOString() });
    await sync.sync();
    await load();
    setBusy(false);
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
        <ProfileBackButton top={insets.top + 12} onPress={() => router.back()} />
      </View>
    );
  }

  const fullName =
    [person.name, person.surname].filter(Boolean).join(" ") ||
    t("personFallbackName", { id: String(userId) });
  return (
    <>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          gap: 22,
          padding: 16,
          paddingBottom: 40,
          paddingTop: insets.top + 70,
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
          <StatusPill tone={person.confirmed ? "success" : "warning"}>
            {person.confirmed
              ? t("scannerConfirmed")
              : person.accepted
                ? t("scannerPlaceUnconfirmed")
                : t("scannerNoAcceptedPlace")}
          </StatusPill>
        </View>

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

        {canAccredit ? (
          <Section title={t("scannerAccreditation")}>
            <InfoRow
              label={t("personCurrentBadge")}
              value={person.badgeId ?? t("personUnassigned")}
              icon="lanyardcard"
            />
            <Separator />
            <ActionButton
              icon="qrcode.viewfinder"
              label={person.badgeId ? t("personReplaceBadge") : t("personLinkBadge")}
              onPress={beginBadgeAction}
            />
            {person.badgeId ? (
              <>
                <Separator />
                <ActionButton
                  destructive
                  icon="trash"
                  label={t("personDeleteBadge")}
                  onPress={confirmRemoveBadge}
                />
              </>
            ) : null}
          </Section>
        ) : null}

        {person.intolerances.length > 0 || person.foodIntoleranceNotes || person.notes ? (
          <Section title={t("personImportantInfo")}>
            {person.intolerances.map((item, index) => (
              <View key={item.id}>
                <InfoRow
                  label={t("personFoodRestriction")}
                  value={item.label[language] ?? item.label.en ?? String(item.id)}
                  icon="exclamationmark.triangle.fill"
                  valueStyle={{ color: colors.warning, fontWeight: "600" }}
                />
                {index < person.intolerances.length - 1 ||
                person.foodIntoleranceNotes ||
                person.notes ? (
                  <Separator />
                ) : null}
              </View>
            ))}
            {person.foodIntoleranceNotes ? (
              <>
                <InfoRow
                  label={t("personFoodNotes")}
                  value={person.foodIntoleranceNotes}
                  icon="fork.knife"
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
          <Section title={t("personPresenceTitle")} footer={t("personPresenceFooter")}>
            <View style={{ gap: 14, padding: 16 }}>
              <SegmentedControl
                label={t("personMovement")}
                values={[t("scannerIn"), t("scannerOut")]}
                selectedIndex={direction === "in" ? 0 : 1}
                onChange={(index) => setDirection(index === 0 ? "in" : "out")}
              />
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
              disabled={!person.badgeId}
              icon={direction === "in" ? "arrow.right.to.line" : "arrow.left.to.line"}
              label={direction === "in" ? t("personRegisterEntry") : t("personRegisterExit")}
              onPress={() => void registerPresence()}
            />
            {history.map((item) => (
              <View key={item.id}>
                <Separator />
                <InfoRow
                  label={item.kind === "in" ? t("scannerIn") : t("scannerOut")}
                  value={new Date(item.scannedAt).toLocaleString(language)}
                  icon={item.kind === "in" ? "arrow.right.to.line" : "arrow.left.to.line"}
                />
              </View>
            ))}
          </Section>
        ) : null}
      </ScrollView>
      <ProfileBackButton top={insets.top + 12} onPress={() => router.back()} />
    </>
  );
}

function ProfileBackButton({ top, onPress }: { top: number; onPress: () => void }) {
  const { t } = useLocale();
  return (
    <GlassView
      glassEffectStyle="regular"
      isInteractive
      style={{ borderRadius: 22, height: 44, left: 16, position: "absolute", top, width: 44 }}
    >
      <Pressable
        accessibilityLabel={t("back")}
        accessibilityRole="button"
        onPress={onPress}
        style={{ alignItems: "center", flex: 1, justifyContent: "center" }}
      >
        <SymbolView name="chevron.left" tintColor={colors.label} size={19} weight="semibold" />
      </Pressable>
    </GlassView>
  );
}
