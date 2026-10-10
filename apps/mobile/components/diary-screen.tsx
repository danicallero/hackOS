import { CAPABILITIES } from "@hackos/shared/capabilities";
import { useFocusEffect, useLocalSearchParams, useRouter, useScrollToTop } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  Modal,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  RefreshControl,
  ScrollView,
  TextInput,
  useColorScheme,
  View,
} from "react-native";
import { BadgeLinkActions, type ScanActionLabels } from "@/components/badge-link-actions";
import { CompanyAlbum, CompanySheet } from "@/components/company-album";
import { DiaryNoteEditor } from "@/components/diary-note-editor";
import { DiaryPersonRow, PERSON_ROW_TEXT_INSET } from "@/components/diary-person-row";
import { FavouriteStar } from "@/components/favourite-star";
import { AndroidStatusBarScrim, EmptyState, Section, Separator } from "@/components/native-ui";
import { NfcReader } from "@/components/nfc-reader";
import { QrCamera } from "@/components/QrCamera";
import { RequestFeedback } from "@/components/RequestFeedback";
import { ScannerCodeEntry } from "@/components/scanner-code-entry";
import { SegmentedControl } from "@/components/segmented-control";
import { SymbolView } from "@/components/symbol";
import { apiFetch } from "@/lib/api";
import { type DiaryEntry, diaryScanErrorKey, upsertDiaryEntry } from "@/lib/diary";
import {
  type SponsorCollection,
  type SponsorCollectionItem,
  withCompanyEntry,
} from "@/lib/diary-sponsors";
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

type ScanInput = "nfc" | "qr" | "manual";
type DiarySection = "people" | "companies" | "directory";
type NoteTarget = { kind: "person"; entry: DiaryEntry } | { kind: "company"; enterpriseId: number };

const JSON_HEADERS = () => ({
  "content-type": "application/json",
  "Idempotency-Key": createIdempotencyKey(),
});

/**
 * Event diary (#935), in two segments:
 * - People: those this attendee saved, searched locally (cards never carry
 *   an email). A `directory:read` holder can also browse the directory,
 *   searched by name on the server. Saving and favouriting are separate: the
 *   star only marks a saved person; only "Remove from diary" removes one.
 * - Companies: a sticker album of the sponsor stands to collect.
 * Scanning starts NFC directly where supported (R008); QR and manual entry
 * stay in the compact menu. Cards come live from the API and are never cached
 * on the device, so a profile hidden later disappears here.
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
  // iOS rests at a negative offset under `contentInsetAdjustmentBehavior=
  // "automatic"`, so `y: 0` would leave the first rows under the status bar.
  // Track the resting offset and only scroll when the list has moved.
  const restOffset = useRef(0);
  const currentOffset = useRef(0);
  const scrollToTop = () => {
    if (currentOffset.current <= restOffset.current + 1) return;
    scrollRef.current?.scrollTo?.({ y: restOffset.current, animated: true });
  };

  // Deep links may open a segment directly: `/diary?view=companies`, or
  // `/diary?view=directory` for a directory reader's People > Directory.
  const { view } = useLocalSearchParams<{ view?: string }>();
  const [section, setSection] = useState<DiarySection>(
    view === "companies" || view === "directory" ? view : "people",
  );
  useEffect(() => {
    if (view === "companies" || view === "directory" || view === "people") setSection(view);
  }, [view]);
  // People filters its saved cards locally; Directory searches the server.
  // Each keeps its own text, so switching segments never carries a query over.
  const [query, setQuery] = useState("");
  const [directoryQuery, setDirectoryQuery] = useState("");
  const [favouritesOnly, setFavouritesOnly] = useState(false);
  const [entries, setEntries] = useState<DiaryEntry[] | null>(null);
  const [collection, setCollection] = useState<SponsorCollection | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [collectionError, setCollectionError] = useState<Error | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [input, setInput] = useState<ScanInput | null>(null);
  const [scanning, setScanning] = useState(false);
  const [savedId, setSavedId] = useState<number | null>(null);
  const [highlightId, setHighlightId] = useState<number | null>(null);
  const [busyKeys, setBusyKeys] = useState<ReadonlySet<string>>(new Set());
  const [noteTarget, setNoteTarget] = useState<NoteTarget | null>(null);
  const [openCompanyId, setOpenCompanyId] = useState<number | null>(null);
  const requestId = useRef(0);
  const collectionRequestId = useRef(0);
  const scanInFlight = useRef(false);
  const showDirectory = canBrowse && section === "directory";
  const directory = useDirectory(showDirectory, directoryQuery);
  // People | Companies, plus Directory for a `directory:read` holder: the
  // same three sibling views as the web diary, in one control (#935).
  const sections: DiarySection[] = canBrowse
    ? ["people", "companies", "directory"]
    : ["people", "companies"];
  const sectionLabels: Record<DiarySection, string> = {
    people: t("diaryPeopleTab"),
    companies: t("diaryCompaniesTab"),
    directory: t("diaryDirectoryTab"),
  };

  const load = useCallback(async () => {
    const request = ++requestId.current;
    try {
      const { items } = await apiFetch<{ items: DiaryEntry[] }>("/api/me/diary");
      if (request !== requestId.current) return;
      setEntries(items.filter((entry) => entry.kind === "person"));
      setLoadError(null);
    } catch (error) {
      if (request !== requestId.current) return;
      setLoadError(error instanceof Error ? error : new Error(String(error)));
    } finally {
      if (request === requestId.current) setLoading(false);
    }
  }, []);

  const loadCollection = useCallback(async () => {
    const request = ++collectionRequestId.current;
    try {
      const next = await apiFetch<SponsorCollection>("/api/me/diary/sponsors");
      if (request !== collectionRequestId.current) return;
      setCollection(next);
      setCollectionError(null);
    } catch (error) {
      if (request !== collectionRequestId.current) return;
      setCollectionError(error instanceof Error ? error : new Error(String(error)));
    }
  }, []);

  // Also refreshes after returning from a profile, where the entry may change.
  useFocusEffect(
    useCallback(() => {
      void load();
      void loadCollection();
    }, [load, loadCollection]),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      void load();
      void loadCollection();
    });
    return () => subscription.remove();
  }, [load, loadCollection]);

  /** A mutation's response wins over any list read that started before it. */
  const applyEntry = useCallback((entry: DiaryEntry) => {
    requestId.current += 1;
    setLoading(false);
    setEntries((current) => upsertDiaryEntry(current ?? [], entry));
  }, []);

  const applyCompany = useCallback((enterpriseId: number, entry: DiaryEntry | null) => {
    collectionRequestId.current += 1;
    setCollection((current) =>
      current
        ? withCompanyEntry(
            current,
            enterpriseId,
            entry
              ? {
                  id: entry.id,
                  starred: entry.starred,
                  note: entry.note,
                  createdAt: entry.createdAt,
                }
              : null,
          )
        : current,
    );
  }, []);

  async function onRefresh() {
    setRefreshing(true);
    try {
      if (showDirectory) await directory.reload();
      else await Promise.all([load(), loadCollection()]);
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
        headers: JSON_HEADERS(),
        body: JSON.stringify({ code: value }),
      });
      void haptic("success");
      if (entry.kind === "sponsor") {
        // A collected stand: show its badge celebrating at the top of the
        // album, once the album has the new order.
        setSection("companies");
        setHighlightId(entry.sponsor?.enterpriseId ?? null);
        await loadCollection();
        scrollToTop();
      } else {
        scrollToTop();
        applyEntry(entry);
        setSavedId(entry.id);
        setSection("people");
      }
    } catch (error) {
      void haptic("error");
      Alert.alert(t("tabDiary"), t(diaryScanErrorKey(error)));
    } finally {
      scanInFlight.current = false;
      setScanning(false);
    }
  }

  async function mutate(key: string, action: () => Promise<void>, errorKey = "diaryActionError") {
    if (busyKeys.has(key)) return;
    setBusyKeys((current) => new Set(current).add(key));
    try {
      await action();
    } catch {
      void haptic("error");
      Alert.alert(t("tabDiary"), t(errorKey as "diaryActionError"));
    } finally {
      setBusyKeys((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  }

  function patchEntry(entryId: number, patch: { starred?: boolean; note?: string }) {
    return apiFetch<DiaryEntry>(`/api/me/diary/${entryId}`, {
      method: "PATCH",
      headers: JSON_HEADERS(),
      body: JSON.stringify(patch),
    });
  }

  function updatePerson(entry: DiaryEntry, patch: { starred?: boolean; note?: string }) {
    return mutate(`entry:${entry.id}`, async () => {
      applyEntry(await patchEntry(entry.id, patch));
      void haptic("selection");
    });
  }

  function confirmRemove(onConfirm: () => void) {
    Alert.alert(t("diaryRemoveTitle"), undefined, [
      { text: t("cancel"), style: "cancel" },
      { text: t("remove"), style: "destructive", onPress: onConfirm },
    ]);
  }

  function removePerson(entry: DiaryEntry) {
    confirmRemove(
      () =>
        void mutate(`entry:${entry.id}`, async () => {
          await apiFetch(`/api/me/diary/${entry.id}`, {
            method: "DELETE",
            headers: { "Idempotency-Key": createIdempotencyKey() },
          });
          requestId.current += 1;
          setEntries((current) => (current ?? []).filter((item) => item.id !== entry.id));
          if (savedId === entry.id) setSavedId(null);
        }),
    );
  }

  function savePerson(person: DirectoryEntry) {
    return mutate(
      `user:${person.userId}`,
      async () => {
        applyEntry(
          await apiFetch<DiaryEntry>("/api/me/diary/people", {
            method: "POST",
            headers: JSON_HEADERS(),
            body: JSON.stringify({ userId: person.userId }),
          }),
        );
        void haptic("success");
      },
      "directorySaveError",
    );
  }

  const openCompany = collection?.items.find((item) => item.enterpriseId === openCompanyId) ?? null;

  function updateCompany(item: SponsorCollectionItem, patch: { starred?: boolean; note?: string }) {
    const entry = item.entry;
    if (!entry) return;
    return mutate(`company:${item.enterpriseId}`, async () => {
      applyCompany(item.enterpriseId, await patchEntry(entry.id, patch));
      void haptic("selection");
    });
  }

  function removeCompany(item: SponsorCollectionItem) {
    const entry = item.entry;
    if (!entry) return;
    confirmRemove(
      () =>
        void mutate(`company:${item.enterpriseId}`, async () => {
          await apiFetch(`/api/me/diary/${entry.id}`, {
            method: "DELETE",
            headers: { "Idempotency-Key": createIdempotencyKey() },
          });
          setOpenCompanyId(null);
          applyCompany(item.enterpriseId, null);
        }),
    );
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
  const pinned = searching ? null : (visible.find((entry) => entry.id === savedId) ?? null);
  const rest = visible.filter((entry) => entry.id !== pinned?.id);
  const savedByUser = useMemo(
    () =>
      new Map(
        (entries ?? []).flatMap((entry) => (entry.person ? [[entry.person.userId, entry]] : [])),
      ) as Map<number, DiaryEntry>,
    [entries],
  );

  function savedRow(entry: DiaryEntry) {
    const person = entry.person;
    return (
      <DiaryPersonRow
        testID={`diary-entry-${entry.id}`}
        name={person?.displayName ?? t("diaryUnavailablePerson")}
        available={person !== null}
        photoUrl={person?.photoUrl ?? null}
        headline={person?.headline}
        detail={entry.note ?? person?.project?.name}
        detailIsNote={Boolean(entry.note)}
        saved
        starred={entry.starred}
        busy={busyKeys.has(`entry:${entry.id}`)}
        onOpen={person ? () => openPerson(person.userId) : undefined}
        // A hidden profile can no longer be favourited; it keeps only its
        // note and "Remove from diary", so its name is not truncated.
        onToggleStar={
          person ? () => void updatePerson(entry, { starred: !entry.starred }) : undefined
        }
        onEditNote={() => setNoteTarget({ kind: "person", entry })}
        onRemove={() => removePerson(entry)}
      />
    );
  }

  function directoryRow(person: DirectoryEntry) {
    const entry = savedByUser.get(person.userId) ?? null;
    return (
      <DiaryPersonRow
        name={person.displayName}
        photoUrl={person.photoUrl}
        headline={person.headline}
        detail={entry?.note ?? person.project?.name}
        detailIsNote={Boolean(entry?.note)}
        saved={entry !== null}
        starred={entry?.starred ?? false}
        busy={busyKeys.has(entry ? `entry:${entry.id}` : `user:${person.userId}`)}
        onOpen={() => openPerson(person.userId)}
        onSave={() => void savePerson(person)}
        onToggleStar={
          entry ? () => void updatePerson(entry, { starred: !entry.starred }) : undefined
        }
        onEditNote={entry ? () => setNoteTarget({ kind: "person", entry }) : undefined}
        onRemove={entry ? () => removePerson(entry) : undefined}
      />
    );
  }

  function onScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    currentOffset.current = contentOffset.y;
    // The adjusted inset is not reported; the lowest offset seen is the rest.
    restOffset.current = Math.min(restOffset.current, contentOffset.y);
    if (!showDirectory) return;
    if (contentOffset.y + layoutMeasurement.height > contentSize.height - 400) {
      void directory.loadMore();
    }
  }

  const noteInitial =
    noteTarget?.kind === "person"
      ? noteTarget.entry.note
      : noteTarget?.kind === "company"
        ? (collection?.items.find((item) => item.enterpriseId === noteTarget.enterpriseId)?.entry
            ?.note ?? null)
        : null;

  return (
    <>
      <NfcReader
        visible={input === "nfc"}
        onValue={(uid) => void submitScan(uid)}
        onClose={() => setInput(null)}
      />
      <ScannerCodeEntry
        visible={input === "manual"}
        appearance="system"
        title={t("personEnterBadgeCode")}
        placeholder={null}
        submitLabel={t("save")}
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
      <CompanySheet
        item={openCompany}
        busy={openCompany ? busyKeys.has(`company:${openCompany.enterpriseId}`) : false}
        onClose={() => setOpenCompanyId(null)}
        onToggleStar={() => {
          if (openCompany)
            void updateCompany(openCompany, { starred: !openCompany.entry?.starred });
        }}
        onEditNote={() => {
          if (openCompany)
            setNoteTarget({ kind: "company", enterpriseId: openCompany.enterpriseId });
        }}
        onRemove={() => {
          if (openCompany) removeCompany(openCompany);
        }}
      />
      <DiaryNoteEditor
        visible={noteTarget !== null}
        initialNote={noteInitial}
        onClose={() => setNoteTarget(null)}
        onSave={(note) => {
          const target = noteTarget;
          setNoteTarget(null);
          if (target?.kind === "person") void updatePerson(target.entry, { note });
          if (target?.kind === "company") {
            const item = collection?.items.find((i) => i.enterpriseId === target.enterpriseId);
            if (item) void updateCompany(item, { note });
          }
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
        <SegmentedControl
          label={t("diaryViews")}
          values={sections.map((key) => sectionLabels[key])}
          selectedIndex={Math.max(0, sections.indexOf(section))}
          onChange={(index) => setSection(sections[index] ?? "people")}
        />
        {section === "companies" ? (
          collection ? (
            <CompanyAlbum
              collection={collection}
              highlightId={highlightId}
              onOpen={(item) => setOpenCompanyId(item.enterpriseId)}
            />
          ) : (
            <RequestFeedback
              loading={!collectionError}
              error={collectionError}
              onRetry={() => void loadCollection()}
            />
          )
        ) : (
          <>
            {showDirectory || (entries?.length ?? 0) > 0 ? (
              <View style={{ alignItems: "center", flexDirection: "row", gap: 10 }}>
                <SearchField
                  value={showDirectory ? directoryQuery : query}
                  onChangeText={showDirectory ? setDirectoryQuery : setQuery}
                  placeholder={t(
                    showDirectory ? "directorySearchPlaceholder" : "diarySearchPlaceholder",
                  )}
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
                      backgroundColor: favouritesOnly ? colors.warningSurface : colors.surface,
                      borderColor: favouritesOnly ? colors.warning : "transparent",
                      borderCurve: "continuous",
                      borderRadius: 12,
                      borderWidth: 1,
                      height: 44,
                      justifyContent: "center",
                      opacity: pressed ? 0.7 : 1,
                      width: 44,
                    })}
                  >
                    <FavouriteStar on={favouritesOnly} />
                  </Pressable>
                )}
              </View>
            ) : null}
            {showDirectory ? (
              <DirectoryResults state={directory} query={directoryQuery} renderRow={directoryRow} />
            ) : (
              <>
                {loadError ? (
                  <RequestFeedback error={loadError} onRetry={() => void load()} />
                ) : null}
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
                    {pinned ? <Section title={t("diarySaved")}>{savedRow(pinned)}</Section> : null}
                    {rest.length > 0 ? (
                      <Section>
                        {rest.map((entry, index) => (
                          <View key={entry.id}>
                            {index > 0 ? <Separator inset={PERSON_ROW_TEXT_INSET} /> : null}
                            {savedRow(entry)}
                          </View>
                        ))}
                      </Section>
                    ) : null}
                  </>
                )}
              </>
            )}
          </>
        )}
      </ScrollView>
      <AndroidStatusBarScrim />
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
  renderRow,
}: {
  state: DirectoryState;
  query: string;
  renderRow: (person: DirectoryEntry) => React.ReactNode;
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
        {state.items.map((person, index) => (
          <View key={person.userId}>
            {index > 0 ? <Separator inset={PERSON_ROW_TEXT_INSET} /> : null}
            {renderRow(person)}
          </View>
        ))}
      </Section>
      {state.loadingMore ? <ActivityIndicator color={colors.secondaryLabel} /> : null}
    </View>
  );
}
