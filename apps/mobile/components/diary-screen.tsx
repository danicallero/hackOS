import { MenuView } from "@expo/ui/community/menu";
import { useScrollToTop } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  AppState,
  Image,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  useColorScheme,
  View,
} from "react-native";
import { BadgeLinkActions, type ScanActionLabels } from "@/components/badge-link-actions";
import { ActionButton, EmptyState, Section, Separator } from "@/components/native-ui";
import { NfcReader } from "@/components/nfc-reader";
import { QrCamera } from "@/components/QrCamera";
import { RequestFeedback } from "@/components/RequestFeedback";
import { ScannerCodeEntry } from "@/components/scanner-code-entry";
import { SymbolView } from "@/components/symbol";
import { apiFetch } from "@/lib/api";
import {
  type DiaryEntry,
  diaryInitials,
  diaryScanErrorKey,
  isDiaryEntryAvailable,
  upsertDiaryEntry,
} from "@/lib/diary";
import { haptic } from "@/lib/haptics";
import { useLocale } from "@/lib/i18n";
import { createIdempotencyKey } from "@/lib/idempotency-key";
import { useRouterTabBarScrollBottomInset } from "@/lib/router-tabs-inset";
import { useAndroidTopInset } from "@/lib/use-android-top-inset";
import { colors } from "@/theme/colors";

const SCAN_LABELS: ScanActionLabels = {
  nfc: "diaryScanNfc",
  qr: "personScanBadgeCode",
  manual: "personEnterBadgeCode",
  options: "diaryScanOptions",
};

const NOTE_MAX_LENGTH = 500;

type ScanInput = "nfc" | "qr" | "manual";

/**
 * Event diary (#935): the people and sponsor stands this attendee saved,
 * favourites first. Scanning starts NFC directly where supported (R008); QR
 * and manual entry stay in the compact menu. Cards come live from the API and
 * are never cached on the device, so a profile hidden later disappears here.
 */
export function DiaryScreen() {
  useColorScheme();
  const { t } = useLocale();
  const androidTopInset = useAndroidTopInset();
  const tabBarBottomInset = useRouterTabBarScrollBottomInset();
  const scrollRef = useRef<ScrollView>(null);
  useScrollToTop(scrollRef);

  const [entries, setEntries] = useState<DiaryEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [input, setInput] = useState<ScanInput | null>(null);
  const [scanning, setScanning] = useState(false);
  const [savedId, setSavedId] = useState<number | null>(null);
  const [busyIds, setBusyIds] = useState<ReadonlySet<number>>(new Set());
  const [noteEntry, setNoteEntry] = useState<DiaryEntry | null>(null);
  const requestId = useRef(0);
  const scanInFlight = useRef(false);

  const load = useCallback(async () => {
    const request = ++requestId.current;
    try {
      const { items } = await apiFetch<{ items: DiaryEntry[] }>("/api/me/diary");
      if (request !== requestId.current) return;
      setEntries(items);
      setLoadError(null);
    } catch (error) {
      if (request !== requestId.current) return;
      setLoadError(error instanceof Error ? error : new Error(String(error)));
    } finally {
      if (request === requestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void load();
    });
    return () => subscription.remove();
  }, [load]);

  /** A mutation's response wins over any list read that started before it. */
  const applyEntry = useCallback((entry: DiaryEntry) => {
    requestId.current += 1;
    setLoading(false);
    setEntries((current) => upsertDiaryEntry(current ?? [], entry));
  }, []);

  async function onRefresh() {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }

  async function submitScan(code: string) {
    const value = code.trim();
    if (!value || scanInFlight.current) return;
    scanInFlight.current = true;
    setScanning(true);
    try {
      const entry = await apiFetch<DiaryEntry>("/api/me/diary/scan", {
        method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": createIdempotencyKey() },
        body: JSON.stringify({ code: value }),
      });
      applyEntry(entry);
      setSavedId(entry.id);
      void haptic("success");
      scrollRef.current?.scrollTo?.({ y: 0, animated: true });
    } catch (error) {
      void haptic("error");
      Alert.alert(t("tabDiary"), t(diaryScanErrorKey(error)));
    } finally {
      scanInFlight.current = false;
      setScanning(false);
    }
  }

  async function mutate(entry: DiaryEntry, action: () => Promise<void>) {
    if (busyIds.has(entry.id)) return;
    setBusyIds((current) => new Set(current).add(entry.id));
    try {
      await action();
    } catch {
      Alert.alert(t("tabDiary"), t("diaryActionError"));
    } finally {
      setBusyIds((current) => {
        const next = new Set(current);
        next.delete(entry.id);
        return next;
      });
    }
  }

  function update(entry: DiaryEntry, patch: { starred?: boolean; note?: string }) {
    return mutate(entry, async () => {
      const updated = await apiFetch<DiaryEntry>(`/api/me/diary/${entry.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "Idempotency-Key": createIdempotencyKey() },
        body: JSON.stringify(patch),
      });
      applyEntry(updated);
      void haptic("selection");
    });
  }

  function confirmRemove(entry: DiaryEntry) {
    Alert.alert(t("diaryRemoveTitle"), undefined, [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("remove"),
        style: "destructive",
        onPress: () =>
          void mutate(entry, async () => {
            await apiFetch(`/api/me/diary/${entry.id}`, {
              method: "DELETE",
              headers: { "Idempotency-Key": createIdempotencyKey() },
            });
            requestId.current += 1;
            setEntries((current) => (current ?? []).filter((item) => item.id !== entry.id));
            if (savedId === entry.id) setSavedId(null);
          }),
      },
    ]);
  }

  const inputOpen = input !== null;
  const saved = entries?.find((entry) => entry.id === savedId) ?? null;
  const rest = (entries ?? []).filter((entry) => entry.id !== saved?.id);
  const rowProps = (entry: DiaryEntry) => ({
    entry,
    busy: busyIds.has(entry.id),
    onToggleStar: () => void update(entry, { starred: !entry.starred }),
    onEditNote: () => setNoteEntry(entry),
    onRemove: () => confirmRemove(entry),
  });

  return (
    <>
      <NfcReader
        visible={input === "nfc"}
        onValue={(uid) => void submitScan(uid)}
        onClose={() => setInput(null)}
      />
      <ScannerCodeEntry
        visible={input === "manual"}
        onValue={(code) => void submitScan(code)}
        onClose={() => setInput(null)}
      />
      <Modal visible={input === "qr"} animationType="slide" onRequestClose={() => setInput(null)}>
        {input === "qr" ? (
          <QrCamera
            onClose={() => setInput(null)}
            onValue={(code) => {
              setInput(null);
              void submitScan(code);
            }}
          />
        ) : null}
      </Modal>
      <NoteEditor
        entry={noteEntry}
        onClose={() => setNoteEntry(null)}
        onSave={(entry, note) => {
          setNoteEntry(null);
          void update(entry, { note });
        }}
      />
      <ScrollView
        ref={scrollRef}
        accessibilityElementsHidden={inputOpen}
        importantForAccessibility={inputOpen ? "no-hide-descendants" : "auto"}
        contentInsetAdjustmentBehavior="automatic"
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={{
          gap: 20,
          padding: 16,
          paddingBottom: Math.max(32, tabBarBottomInset + 16),
          paddingTop: 16 + androidTopInset,
        }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />
        }
      >
        <BadgeLinkActions
          testID="diary-scan"
          labels={SCAN_LABELS}
          disabled={scanning || inputOpen}
          onNfc={() => setInput("nfc")}
          onAlternative={setInput}
        />
        {loadError ? <RequestFeedback error={loadError} onRetry={() => void load()} /> : null}
        {entries === null ? (
          loadError ? null : (
            <RequestFeedback loading={loading} error={null} onRetry={() => void load()} />
          )
        ) : entries.length === 0 ? (
          <EmptyState icon="person.2.crop.square.stack" title={t("diaryEmptyTitle")} />
        ) : (
          <>
            {saved ? (
              <Section title={t("diarySaved")}>
                <DiaryRow {...rowProps(saved)} />
              </Section>
            ) : null}
            {rest.length > 0 ? (
              <Section>
                {rest.map((entry, index) => (
                  <View key={entry.id}>
                    {index > 0 ? <Separator /> : null}
                    <DiaryRow {...rowProps(entry)} />
                  </View>
                ))}
              </Section>
            ) : null}
          </>
        )}
      </ScrollView>
    </>
  );
}

function DiaryAvatar({ entry }: { entry: DiaryEntry }) {
  const size = 44;
  const uri = entry.person?.photoUrl ?? entry.sponsor?.logoUrl ?? null;
  const frame = {
    alignItems: "center" as const,
    backgroundColor: colors.elevatedSurface,
    borderRadius: entry.kind === "person" ? size / 2 : 10,
    height: size,
    justifyContent: "center" as const,
    overflow: "hidden" as const,
    width: size,
  };
  if (uri) {
    return (
      <View style={frame}>
        <Image
          accessible={false}
          source={{ uri }}
          resizeMode={entry.kind === "person" ? "cover" : "contain"}
          style={{ height: size, width: size }}
        />
      </View>
    );
  }
  if (entry.person) {
    return (
      <View style={frame}>
        <Text style={{ color: colors.secondaryLabel, fontSize: 16, fontWeight: "600" }}>
          {diaryInitials(entry.person.displayName)}
        </Text>
      </View>
    );
  }
  return (
    <View style={frame}>
      <SymbolView
        accessible={false}
        name={entry.kind === "person" ? "person.fill" : "building.2"}
        size={20}
        tintColor={colors.secondaryLabel}
      />
    </View>
  );
}

function DiaryRow({
  entry,
  busy,
  onToggleStar,
  onEditNote,
  onRemove,
}: {
  entry: DiaryEntry;
  busy: boolean;
  onToggleStar: () => void;
  onEditNote: () => void;
  onRemove: () => void;
}) {
  const { t } = useLocale();
  const available = isDiaryEntryAvailable(entry);
  const title =
    entry.person?.displayName ??
    entry.sponsor?.name ??
    t(entry.kind === "person" ? "diaryUnavailablePerson" : "diaryUnavailableSponsor");
  const challenges = entry.person?.challenges ?? entry.sponsor?.challenges ?? [];
  const secondary = { color: colors.secondaryLabel, fontSize: 14, lineHeight: 19 };
  const website = entry.sponsor?.website ?? null;

  return (
    <View
      testID={`diary-entry-${entry.id}`}
      style={{ flexDirection: "row", gap: 12, paddingHorizontal: 16, paddingVertical: 12 }}
    >
      <DiaryAvatar entry={entry} />
      <View style={{ flex: 1, gap: 3 }}>
        <Text
          selectable
          style={{
            color: available ? colors.label : colors.secondaryLabel,
            fontSize: 17,
            fontWeight: available ? "600" : "400",
          }}
        >
          {title}
        </Text>
        {entry.person?.headline ? (
          <Text selectable style={secondary}>
            {entry.person.headline}
          </Text>
        ) : null}
        {entry.person?.project ? (
          <Text selectable style={secondary}>
            {entry.person.project.name}
          </Text>
        ) : null}
        {entry.sponsor?.description ? (
          <Text selectable numberOfLines={3} style={secondary}>
            {entry.sponsor.description}
          </Text>
        ) : null}
        {challenges.length > 0 ? (
          <Text selectable style={{ ...secondary, color: colors.accent }}>
            {challenges.map((challenge) => challenge.name).join(" · ")}
          </Text>
        ) : null}
        {entry.person?.locationNote ? (
          <Text selectable style={secondary}>
            {entry.person.locationNote}
          </Text>
        ) : null}
        {website ? (
          <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(website)}>
            <Text style={{ ...secondary, color: colors.interactiveText }}>
              {website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
            </Text>
          </Pressable>
        ) : null}
        {entry.note ? (
          <Text selectable style={{ ...secondary, color: colors.label, fontStyle: "italic" }}>
            {entry.note}
          </Text>
        ) : null}
      </View>
      <View style={{ alignItems: "center", flexDirection: "row", alignSelf: "flex-start" }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(entry.starred ? "diaryUnfavourite" : "diaryFavourite")}
          accessibilityState={{ disabled: busy, selected: entry.starred }}
          disabled={busy}
          hitSlop={6}
          onPress={onToggleStar}
          style={({ pressed }) => ({
            alignItems: "center",
            height: 40,
            justifyContent: "center",
            opacity: busy ? 0.45 : pressed ? 0.6 : 1,
            width: 40,
          })}
        >
          <SymbolView
            accessible={false}
            name={entry.starred ? "star.fill" : "star"}
            size={20}
            tintColor={entry.starred ? colors.warning : colors.secondaryLabel}
          />
        </Pressable>
        <MenuView
          shouldOpenOnLongPress={false}
          actions={[
            {
              id: "note",
              title: t("diaryNote"),
              image: "pencil",
              attributes: { disabled: busy },
            },
            {
              id: "remove",
              title: t("remove"),
              image: "trash",
              attributes: { destructive: true, disabled: busy },
            },
          ]}
          onPressAction={({ nativeEvent }) => {
            if (busy) return;
            if (nativeEvent.event === "note") onEditNote();
            if (nativeEvent.event === "remove") onRemove();
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("diaryEntryOptions")}
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            style={({ pressed }) => ({
              alignItems: "center",
              height: 40,
              justifyContent: "center",
              opacity: busy ? 0.45 : pressed ? 0.6 : 1,
              width: 36,
            })}
          >
            <SymbolView accessible={false} name="ellipsis" size={18} tintColor={colors.accent} />
          </Pressable>
        </MenuView>
      </View>
    </View>
  );
}

function NoteEditor({
  entry,
  onClose,
  onSave,
}: {
  entry: DiaryEntry | null;
  onClose: () => void;
  onSave: (entry: DiaryEntry, note: string) => void;
}) {
  const { t } = useLocale();
  const [note, setNote] = useState("");
  useEffect(() => {
    setNote(entry?.note ?? "");
  }, [entry]);
  return (
    <Modal transparent visible={entry !== null} animationType="fade" onRequestClose={onClose}>
      <Pressable
        accessibilityLabel={t("close")}
        accessibilityRole="button"
        onPress={onClose}
        style={{ backgroundColor: "rgba(0,0,0,0.4)", position: "absolute", inset: 0 }}
      />
      <View
        pointerEvents="box-none"
        style={{ flex: 1, justifyContent: "center", paddingHorizontal: 20 }}
      >
        <View
          accessibilityViewIsModal
          style={{
            alignSelf: "center",
            backgroundColor: colors.background,
            borderCurve: "continuous",
            borderRadius: 24,
            gap: 14,
            maxWidth: 420,
            padding: 20,
            width: "100%",
          }}
        >
          <Text
            accessibilityRole="header"
            style={{ color: colors.label, fontSize: 18, fontWeight: "700" }}
          >
            {t("diaryNote")}
          </Text>
          <TextInput
            accessibilityLabel={t("diaryNote")}
            autoFocus
            multiline
            maxLength={NOTE_MAX_LENGTH}
            value={note}
            onChangeText={setNote}
            style={{
              backgroundColor: colors.surface,
              borderCurve: "continuous",
              borderRadius: 12,
              color: colors.label,
              fontSize: 17,
              minHeight: 110,
              padding: 14,
              textAlignVertical: "top",
            }}
          />
          <ActionButton
            variant="filled"
            label={t("save")}
            onPress={() => {
              if (entry) onSave(entry, note);
            }}
          />
          <ActionButton label={t("cancel")} onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}
