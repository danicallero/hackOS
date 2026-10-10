import { MenuView } from "@expo/ui/community/menu";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { useFocusEffect, useRouter, useScrollToTop } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  Linking,
  Modal,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  useColorScheme,
  View,
} from "react-native";
import { BadgeLinkActions, type ScanActionLabels } from "@/components/badge-link-actions";
import { DiaryNoteEditor } from "@/components/diary-note-editor";
import { EmptyState, Section, Separator } from "@/components/native-ui";
import { NfcReader } from "@/components/nfc-reader";
import { PersonAvatar } from "@/components/person-avatar";
import { QrCamera } from "@/components/QrCamera";
import { RequestFeedback } from "@/components/RequestFeedback";
import { ScannerCodeEntry } from "@/components/scanner-code-entry";
import { SegmentedControl } from "@/components/segmented-control";
import { SymbolView } from "@/components/symbol";
import { apiFetch } from "@/lib/api";
import {
  type DiaryEntry,
  diaryScanErrorKey,
  isDiaryEntryAvailable,
  upsertDiaryEntry,
} from "@/lib/diary";
import { type DirectoryEntry, type DirectoryPage, filterDiaryEntries } from "@/lib/directory";
import { haptic } from "@/lib/haptics";
import { useLocale } from "@/lib/i18n";
import { createIdempotencyKey } from "@/lib/idempotency-key";
import { useMeContext } from "@/lib/me-context";
import { useRouterTabBarScrollBottomInset } from "@/lib/router-tabs-inset";
import { has } from "@/lib/tabs";
import { useAndroidTopInset } from "@/lib/use-android-top-inset";
import { colors } from "@/theme/colors";

const SCAN_LABELS: ScanActionLabels = {
  nfc: "diaryScanNfc",
  qr: "personScanBadgeCode",
  manual: "personEnterBadgeCode",
  options: "diaryScanOptions",
};

const DIRECTORY_PAGE_SIZE = 30;
const SEARCH_DEBOUNCE_MS = 300;
const ROW_TEXT_INSET = 72;

type ScanInput = "nfc" | "qr" | "manual";
type DiaryView = "saved" | "directory";

/**
 * Event diary (#935): the people and sponsor stands this attendee saved,
 * favourites first. Scanning starts NFC directly where supported (R008); QR
 * and manual entry stay in the compact menu. Cards come live from the API and
 * are never cached on the device, so a profile hidden later disappears here.
 * Saved entries are searched locally (cards never carry an email); a
 * `directory:read` holder also browses the whole directory, searched by name
 * on the server. People open their full profile (`app/people/[id].tsx`).
 */
export function DiaryScreen() {
  useColorScheme();
  const { t } = useLocale();
  const router = useRouter();
  const { me } = useMeContext();
  const canBrowse = has(me?.capabilities ?? [], CAPABILITIES.DIRECTORY_READ);
  const androidTopInset = useAndroidTopInset();
  const tabBarBottomInset = useRouterTabBarScrollBottomInset();
  const scrollRef = useRef<ScrollView>(null);
  useScrollToTop(scrollRef);

  const [view, setView] = useState<DiaryView>("saved");
  const [query, setQuery] = useState("");
  const [favouritesOnly, setFavouritesOnly] = useState(false);
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
  const directory = useDirectory(canBrowse && view === "directory", query);
  const showDirectory = canBrowse && view === "directory";

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

  // Also refreshes after returning from a profile, where the entry may change.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  useEffect(() => {
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
      await (showDirectory ? directory.reload() : load());
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
      setView("saved");
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

  const [savingUserId, setSavingUserId] = useState<number | null>(null);
  async function savePerson(person: DirectoryEntry) {
    if (savingUserId !== null) return;
    setSavingUserId(person.userId);
    try {
      const entry = await apiFetch<DiaryEntry>("/api/me/diary/people", {
        method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": createIdempotencyKey() },
        body: JSON.stringify({ userId: person.userId }),
      });
      applyEntry(entry);
      void haptic("success");
    } catch {
      void haptic("error");
      Alert.alert(t("tabDiary"), t("directorySaveError"));
    } finally {
      setSavingUserId(null);
    }
  }

  const openPerson = useCallback(
    (userId: number) => router.push({ pathname: "/people/[id]", params: { id: String(userId) } }),
    [router],
  );

  const inputOpen = input !== null;
  const searching = query.trim() !== "" || favouritesOnly;
  const visible = useMemo(
    () => filterDiaryEntries(entries ?? [], { query, favouritesOnly }),
    [entries, query, favouritesOnly],
  );
  // The just-scanned card is pinned on top only while nothing filters the list.
  const saved = searching ? null : (visible.find((entry) => entry.id === savedId) ?? null);
  const rest = visible.filter((entry) => entry.id !== saved?.id);
  const savedUserIds = useMemo(
    () => new Set((entries ?? []).flatMap((entry) => (entry.person ? [entry.person.userId] : []))),
    [entries],
  );
  const rowProps = (entry: DiaryEntry) => ({
    entry,
    busy: busyIds.has(entry.id),
    onOpen:
      entry.kind === "person" && entry.person ? () => openPerson(entry.person!.userId) : undefined,
    onToggleStar: () => void update(entry, { starred: !entry.starred }),
    onEditNote: () => setNoteEntry(entry),
    onRemove: () => confirmRemove(entry),
  });

  function onScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    if (!showDirectory) return;
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    if (contentOffset.y + layoutMeasurement.height > contentSize.height - 400) {
      void directory.loadMore();
    }
  }

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
      <DiaryNoteEditor
        entry={noteEntry}
        onClose={() => setNoteEntry(null)}
        onSave={(entry, note) => {
          setNoteEntry(null);
          void update(entry, { note });
        }}
      />
      <ScrollView
        ref={scrollRef}
        testID="diary-scroll"
        accessibilityElementsHidden={inputOpen}
        importantForAccessibility={inputOpen ? "no-hide-descendants" : "auto"}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        onScroll={onScroll}
        scrollEventThrottle={200}
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={{
          gap: 16,
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
        {canBrowse ? (
          <SegmentedControl
            label={t("diaryViews")}
            values={[t("diarySavedTab"), t("diaryDirectoryTab")]}
            selectedIndex={view === "saved" ? 0 : 1}
            onChange={(index) => setView(index === 0 ? "saved" : "directory")}
          />
        ) : null}
        <View style={{ alignItems: "center", flexDirection: "row", gap: 10 }}>
          <SearchField
            value={query}
            onChangeText={setQuery}
            placeholder={t(showDirectory ? "directorySearchPlaceholder" : "diarySearchPlaceholder")}
            label={t("scheduleSearch")}
            clearLabel={t("cancel")}
          />
          {showDirectory ? null : (
            <Pressable
              accessibilityRole="togglebutton"
              accessibilityLabel={t("diaryShowFavourites")}
              accessibilityState={{ checked: favouritesOnly }}
              hitSlop={4}
              onPress={() => {
                void haptic("selection");
                setFavouritesOnly((value) => !value);
              }}
              style={({ pressed }) => ({
                alignItems: "center",
                backgroundColor: favouritesOnly ? colors.warning : colors.surface,
                borderCurve: "continuous",
                borderRadius: 12,
                height: 44,
                justifyContent: "center",
                opacity: pressed ? 0.7 : 1,
                width: 44,
              })}
            >
              <SymbolView
                accessible={false}
                name={favouritesOnly ? "star.fill" : "star"}
                size={20}
                tintColor={favouritesOnly ? colors.background : colors.secondaryLabel}
              />
            </Pressable>
          )}
        </View>
        {showDirectory ? (
          <DirectoryResults
            state={directory}
            query={query}
            savedUserIds={savedUserIds}
            savingUserId={savingUserId}
            onOpen={openPerson}
            onSave={(person) => void savePerson(person)}
          />
        ) : (
          <>
            {loadError ? <RequestFeedback error={loadError} onRetry={() => void load()} /> : null}
            {entries === null ? (
              loadError ? null : (
                <RequestFeedback loading={loading} error={null} onRetry={() => void load()} />
              )
            ) : entries.length === 0 ? (
              <EmptyState icon="person.2.crop.square.stack" title={t("diaryEmptyTitle")} />
            ) : visible.length === 0 ? (
              favouritesOnly && !query.trim() ? (
                <EmptyState icon="star" title={t("diaryNoFavourites")} />
              ) : (
                <EmptyState icon="magnifyingglass" title={t("scannerNoResults")} />
              )
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
                        {index > 0 ? <Separator inset={ROW_TEXT_INSET} /> : null}
                        <DiaryRow {...rowProps(entry)} />
                      </View>
                    ))}
                  </Section>
                ) : null}
              </>
            )}
          </>
        )}
      </ScrollView>
    </>
  );
}

function SearchField({
  value,
  onChangeText,
  placeholder,
  label,
  clearLabel,
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  label: string;
  clearLabel: string;
}) {
  return (
    <View
      style={{
        alignItems: "center",
        backgroundColor: colors.surface,
        borderCurve: "continuous",
        borderRadius: 12,
        flex: 1,
        flexDirection: "row",
        gap: 8,
        height: 44,
        paddingHorizontal: 12,
      }}
    >
      <SymbolView
        accessible={false}
        name="magnifyingglass"
        size={17}
        tintColor={colors.secondaryLabel}
      />
      <TextInput
        accessibilityLabel={label}
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="never"
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.tertiaryLabel}
        returnKeyType="search"
        style={{ color: colors.label, flex: 1, fontSize: 17, paddingVertical: 0 }}
        value={value}
      />
      {value ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={clearLabel}
          hitSlop={8}
          onPress={() => onChangeText("")}
        >
          <SymbolView
            accessible={false}
            name="xmark.circle.fill"
            size={17}
            tintColor={colors.tertiaryLabel}
          />
        </Pressable>
      ) : null}
    </View>
  );
}

interface DirectoryState {
  items: DirectoryEntry[] | null;
  error: Error | null;
  loadingMore: boolean;
  reload: () => Promise<void>;
  loadMore: () => Promise<void>;
}

/** Server-side directory pages for `directory:read` holders (#934). */
function useDirectory(enabled: boolean, query: string): DirectoryState {
  const [items, setItems] = useState<DirectoryEntry[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [debounced, setDebounced] = useState(query.trim());
  const requestId = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const fetchPage = useCallback(
    (after: string | null) => {
      const params = new URLSearchParams({ limit: String(DIRECTORY_PAGE_SIZE) });
      if (debounced) params.set("q", debounced);
      if (after) params.set("cursor", after);
      return apiFetch<DirectoryPage>(`/api/directory?${params.toString()}`);
    },
    [debounced],
  );

  const reload = useCallback(async () => {
    const request = ++requestId.current;
    try {
      const page = await fetchPage(null);
      if (request !== requestId.current) return;
      setItems(page.items);
      setCursor(page.nextCursor);
      setError(null);
    } catch (cause) {
      if (request !== requestId.current) return;
      setError(cause instanceof Error ? cause : new Error(String(cause)));
    }
  }, [fetchPage]);

  useEffect(() => {
    if (enabled) void reload();
  }, [enabled, reload]);

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    const request = requestId.current;
    setLoadingMore(true);
    try {
      const page = await fetchPage(cursor);
      if (request !== requestId.current) return;
      setItems((current) => [...(current ?? []), ...page.items]);
      setCursor(page.nextCursor);
    } catch {
      // The next scroll retries; the loaded page stays visible.
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, fetchPage, loadingMore]);

  return { items, error, loadingMore, reload, loadMore };
}

function DirectoryResults({
  state,
  query,
  savedUserIds,
  savingUserId,
  onOpen,
  onSave,
}: {
  state: DirectoryState;
  query: string;
  savedUserIds: ReadonlySet<number>;
  savingUserId: number | null;
  onOpen: (userId: number) => void;
  onSave: (person: DirectoryEntry) => void;
}) {
  const { t } = useLocale();
  if (state.items === null) {
    return state.error ? (
      <RequestFeedback error={state.error} onRetry={() => void state.reload()} />
    ) : (
      <RequestFeedback loading />
    );
  }
  if (state.items.length === 0) {
    return query.trim() ? (
      <EmptyState icon="magnifyingglass" title={t("scannerNoResults")} />
    ) : (
      <EmptyState icon="person.2" title={t("directoryEmpty")} />
    );
  }
  return (
    <View style={{ gap: 16 }}>
      {state.error ? (
        <RequestFeedback error={state.error} onRetry={() => void state.reload()} />
      ) : null}
      <Section>
        {state.items.map((person, index) => {
          const saved = savedUserIds.has(person.userId);
          return (
            <View key={person.userId}>
              {index > 0 ? <Separator inset={ROW_TEXT_INSET} /> : null}
              <View style={{ alignItems: "center", flexDirection: "row" }}>
                <PersonSummary
                  name={person.displayName}
                  photoUrl={person.photoUrl}
                  lines={[person.headline, person.project?.name]}
                  onPress={() => onOpen(person.userId)}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${t(saved ? "directorySaved" : "directorySave")}, ${person.displayName}`}
                  accessibilityState={{ disabled: saved, busy: savingUserId === person.userId }}
                  disabled={saved || savingUserId !== null}
                  hitSlop={6}
                  onPress={() => onSave(person)}
                  style={({ pressed }) => ({
                    alignItems: "center",
                    height: 44,
                    justifyContent: "center",
                    marginRight: 6,
                    opacity: pressed ? 0.6 : 1,
                    width: 44,
                  })}
                >
                  {savingUserId === person.userId ? (
                    <ActivityIndicator color={colors.accent} />
                  ) : (
                    <SymbolView
                      accessible={false}
                      name={saved ? "checkmark.circle.fill" : "plus.circle"}
                      size={22}
                      tintColor={saved ? colors.success : colors.accent}
                    />
                  )}
                </Pressable>
              </View>
            </View>
          );
        })}
      </Section>
      {state.loadingMore ? <ActivityIndicator color={colors.secondaryLabel} /> : null}
    </View>
  );
}

/** Avatar, name and secondary lines; the whole block opens the profile. */
function PersonSummary({
  name,
  photoUrl,
  lines,
  onPress,
}: {
  name: string;
  photoUrl: string | null;
  lines: (string | null | undefined)[];
  onPress: () => void;
}) {
  const secondary = lines.filter(Boolean) as string[];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[name, ...secondary].join(", ")}
      onPress={onPress}
      style={({ pressed }) => ({
        alignItems: "center",
        backgroundColor: pressed ? colors.elevatedSurface : undefined,
        flex: 1,
        flexDirection: "row",
        gap: 12,
        minHeight: 64,
        paddingLeft: 16,
        paddingRight: 8,
        paddingVertical: 10,
      })}
    >
      <PersonAvatar size={44} name={name} uri={photoUrl} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text numberOfLines={1} style={{ color: colors.label, fontSize: 17, fontWeight: "600" }}>
          {name}
        </Text>
        {secondary.map((line) => (
          <Text
            key={line}
            numberOfLines={1}
            style={{ color: colors.secondaryLabel, fontSize: 14, lineHeight: 19 }}
          >
            {line}
          </Text>
        ))}
      </View>
    </Pressable>
  );
}

function DiaryRow({
  entry,
  busy,
  onOpen,
  onToggleStar,
  onEditNote,
  onRemove,
}: {
  entry: DiaryEntry;
  busy: boolean;
  onOpen?: () => void;
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

  const body = (
    <>
      <PersonAvatar
        size={44}
        kind={entry.kind}
        name={entry.person?.displayName}
        uri={entry.person?.photoUrl ?? entry.sponsor?.logoUrl ?? null}
      />
      <View style={{ flex: 1, gap: 3 }}>
        <Text
          selectable={!onOpen}
          style={{
            color: available ? colors.label : colors.secondaryLabel,
            fontSize: 17,
            fontWeight: available ? "600" : "400",
          }}
        >
          {title}
        </Text>
        {entry.person?.headline ? (
          <Text numberOfLines={2} style={secondary}>
            {entry.person.headline}
          </Text>
        ) : null}
        {entry.person?.project ? (
          <Text numberOfLines={1} style={secondary}>
            {entry.person.project.name}
          </Text>
        ) : null}
        {entry.sponsor?.description ? (
          <Text selectable numberOfLines={3} style={secondary}>
            {entry.sponsor.description}
          </Text>
        ) : null}
        {challenges.length > 0 ? (
          <Text numberOfLines={2} style={{ ...secondary, color: colors.accent }}>
            {challenges.map((challenge) => challenge.name).join(" · ")}
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
          <Text numberOfLines={2} style={{ ...secondary, color: colors.label, fontStyle: "italic" }}>
            {entry.note}
          </Text>
        ) : null}
      </View>
    </>
  );

  const bodyStyle = {
    flex: 1,
    flexDirection: "row" as const,
    gap: 12,
    paddingLeft: 16,
    paddingVertical: 12,
  };

  return (
    <View testID={`diary-entry-${entry.id}`} style={{ flexDirection: "row" }}>
      {onOpen ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={title}
          onPress={onOpen}
          style={({ pressed }) => ({
            ...bodyStyle,
            backgroundColor: pressed ? colors.elevatedSurface : undefined,
          })}
        >
          {body}
        </Pressable>
      ) : (
        <View style={bodyStyle}>{body}</View>
      )}
      <View
        style={{
          alignItems: "center",
          alignSelf: "flex-start",
          flexDirection: "row",
          paddingRight: 8,
          paddingTop: 8,
        }}
      >
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
