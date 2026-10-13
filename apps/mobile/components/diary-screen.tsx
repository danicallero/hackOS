import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import Stack from "expo-router/stack";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  AppState,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  useColorScheme,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAccountWallet, WalletModal } from "@/components/account-wallet";
import { BadgeLinkActions, type ScanActionLabels } from "@/components/badge-link-actions";
import { CompanyAlbum, CompanySheet } from "@/components/company-album";
import {
  ConnectionCelebration,
  type ConnectionCelebrationTarget,
} from "@/components/connection-celebration";
import { DiaryNoteEditor } from "@/components/diary-note-editor";
import { DiaryPersonRow, PERSON_ROW_TEXT_INSET } from "@/components/diary-person-row";
import { FavouriteStar } from "@/components/favourite-star";
import { GlassView, isRealLiquidGlassAvailable } from "@/components/glass-view";
import { EmptyState, LegacyScreenHeader, Section, Separator } from "@/components/native-ui";
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
import { filterDiaryEntries } from "@/lib/directory";
import { haptic } from "@/lib/haptics";
import { useLocale } from "@/lib/i18n";
import { useMeContext } from "@/lib/me-context";
import { useRouterTabBarScrollBottomInset } from "@/lib/router-tabs-inset";
import { useAndroidTopInset } from "@/lib/use-android-top-inset";
import { useTrueTopScroll } from "@/lib/use-true-top-scroll";
import { colors } from "@/theme/colors";
import { CHROME_MAX_FONT_SIZE_MULTIPLIER } from "@/theme/dynamic-type";

const SCAN_LABELS: ScanActionLabels = {
  nfc: "diaryScanNfc",
  qr: "personScanBadgeCode",
  manual: "personEnterBadgeCode",
  options: "diaryScanOptions",
};

type ScanInput = "nfc" | "qr" | "manual";
type DiarySection = "people" | "companies";

const SECTIONS: DiarySection[] = ["people", "companies"];
type NoteTarget = { kind: "person"; entry: DiaryEntry } | { kind: "company"; enterpriseId: number };

const JSON_HEADERS = () => ({
  "content-type": "application/json",
});

/**
 * Event diary (#935), in two segments:
 * - People: those this attendee scanned, searched locally (cards never carry
 *   an email). There is no directory to browse: a person gets in only by a
 *   badge scan. The star only marks a saved person; only "Remove from diary"
 *   removes one.
 * - Companies: a sticker album of the sponsor stands to collect.
 * The screen uses the platform header, laid out like Activities: on iOS 26
 * the native bar with the title as a leading item, the native search and the
 * favourites filter as a native toolbar button; elsewhere
 * `LegacyScreenHeader`. Search and
 * the filter apply to People only. Scanning is the shared `BadgeLinkActions`
 * pill in the content (R008: NFC direct where supported, QR and manual code
 * in its menu). Cards come live from the API and are never cached on the
 * device, so a profile hidden later disappears here.
 */
export function DiaryScreen() {
  const colorScheme = useColorScheme();
  const { t } = useLocale();
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  // iOS 26 gets the native large-title header with its own search bar;
  // Android and earlier iOS keep the shared hand-rolled header.
  const glassAvailable = isRealLiquidGlassAvailable();
  const androidTopInset = useAndroidTopInset();
  const legacyTopInset = process.env.EXPO_OS === "ios" ? insets.top : androidTopInset;
  const tabBarBottomInset = useRouterTabBarScrollBottomInset();
  const wallet = useAccountWallet();
  const scrollRef = useRef<ScrollView>(null);
  // iOS rests at a negative offset under `contentInsetAdjustmentBehavior=
  // "automatic"`, so `y: 0` would leave the first rows under the status bar.
  // Only scroll when the list has moved from its true top.
  const trueTop = useTrueTopScroll(scrollRef);
  const scrollToTop = () => {
    if (trueTop.state.current.offset <= trueTop.state.current.top + 1) return;
    trueTop.scrollToTop();
  };

  // Deep links may open a segment directly: `/diary?view=companies`.
  const { view } = useLocalSearchParams<{ view?: string }>();
  const [section, setSection] = useState<DiarySection>(
    view === "companies" ? "companies" : "people",
  );
  useEffect(() => {
    if (view === "companies" || view === "people") setSection(view);
  }, [view]);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
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
  const [celebration, setCelebration] = useState<ConnectionCelebrationTarget | null>(null);
  // The person met, held back from the list until the celebration ends.
  const metEntry = useRef<DiaryEntry | null>(null);
  const celebrations = useRef(0);
  const { me } = useMeContext();
  const [highlightId, setHighlightId] = useState<number | null>(null);
  const [busyKeys, setBusyKeys] = useState<ReadonlySet<string>>(new Set());
  const [noteTarget, setNoteTarget] = useState<NoteTarget | null>(null);
  const [openCompanyId, setOpenCompanyId] = useState<number | null>(null);
  const requestId = useRef(0);
  const collectionRequestId = useRef(0);
  const scanInFlight = useRef(false);
  const sectionLabels: Record<DiarySection, string> = {
    people: t("diaryPeopleTab"),
    companies: t("diaryCompaniesTab"),
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
      await Promise.all([load(), loadCollection()]);
    } finally {
      setRefreshing(false);
    }
  }

  // #935 company-tag links (`app/s/[code].tsx`) open the diary with
  // `?collect=<code>`: collect it once, with the same celebration as a scan.
  const { collect } = useLocalSearchParams<{ collect?: string }>();
  const collected = useRef<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: submitScan is recreated each render; the code itself is the trigger.
  useEffect(() => {
    if (!collect || collected.current === collect) return;
    collected.current = collect;
    router.setParams({ collect: undefined });
    void submitScan(collect);
  }, [collect]);

  /**
   * `fromQr`: the scanner modal stays up until the result is known, so a new
   * connection celebrates over the camera at once instead of after the modal
   * slides away.
   */
  async function submitScan(code: string, fromQr = false) {
    const value = code.trim();
    // The camera keeps reading under the celebration; ignore it until it ends.
    if (!value || scanInFlight.current || metEntry.current) return;
    scanInFlight.current = true;
    setScanning(true);
    try {
      const entry = await apiFetch<DiaryEntry>("/api/me/diary/scan", {
        method: "POST",
        headers: JSON_HEADERS(),
        body: JSON.stringify({ code: value }),
      });
      void haptic("success");
      const isNew =
        entry.kind === "person" &&
        entry.person !== null &&
        entries !== null &&
        !entries.some((current) => current.id === entry.id);
      if (isNew && entry.person) {
        // #935: a new connection plays the celebration first; the list and
        // the person's profile follow when it ends (finishCelebration).
        metEntry.current = entry;
        celebrations.current += 1;
        setCelebration({
          key: celebrations.current,
          name: entry.person.displayName,
          photoUrl: entry.person.photoUrl,
        });
        return;
      }
      if (fromQr) setInput(null);
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
      if (fromQr) setInput(null);
      void haptic("error");
      Alert.alert(t("tabDiary"), t(diaryScanErrorKey(error)));
    } finally {
      scanInFlight.current = false;
      setScanning(false);
    }
  }

  /**
   * While the celebration covers the screen, the person joins the list and
   * their profile opens underneath, so it is already there when it fades.
   */
  function revealMet() {
    const entry = metEntry.current;
    if (!entry) return;
    scrollToTop();
    applyEntry(entry);
    setSavedId(entry.id);
    setSection("people");
    if (entry.person) openPerson(entry.person.userId);
  }

  function finishCelebration() {
    metEntry.current = null;
    setCelebration(null);
    setInput(null);
  }

  async function mutate(key: string, action: () => Promise<void>) {
    if (busyKeys.has(key)) return;
    setBusyKeys((current) => new Set(current).add(key));
    try {
      await action();
    } catch {
      void haptic("error");
      Alert.alert(t("tabDiary"), t("diaryActionError"));
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
          });
          requestId.current += 1;
          setEntries((current) => (current ?? []).filter((item) => item.id !== entry.id));
          if (savedId === entry.id) setSavedId(null);
        }),
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
  // Search and the favourites filter apply to People only, once there is
  // anyone to search; Companies shows the header without them.
  const searchable = section === "people" && (entries?.length ?? 0) > 0;
  const activeQuery = searchable ? query : "";
  const activeFavourites = searchable && favouritesOnly;
  const searching = activeQuery.trim() !== "" || activeFavourites;
  const visible = useMemo(
    () =>
      filterDiaryEntries(entries ?? [], { query: activeQuery, favouritesOnly: activeFavourites }),
    [entries, activeQuery, activeFavourites],
  );
  // The just-scanned card is pinned on top only while nothing filters the list.
  const pinned = searching ? null : (visible.find((entry) => entry.id === savedId) ?? null);
  const rest = visible.filter((entry) => entry.id !== pinned?.id);
  function savedRow(entry: DiaryEntry) {
    const person = entry.person;
    return (
      <DiaryPersonRow
        testID={`diary-entry-${entry.id}`}
        name={person?.displayName ?? t("diaryUnavailablePerson")}
        available={person !== null}
        photoUrl={person?.photoUrl ?? null}
        headline={person?.headline}
        detail={
          entry.note ?? (person?.projects.map((project) => project.name).join(", ") || undefined)
        }
        detailIsNote={Boolean(entry.note)}
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

  function toggleFavourites() {
    void haptic("selection");
    setFavouritesOnly((value) => !value);
  }

  function selectSection(next: DiarySection) {
    setSection(next);
    // The query belongs to People; leaving it closes the field.
    if (next !== "people") {
      setSearchOpen(false);
      setQuery("");
    }
  }

  useLayoutEffect(() => {
    if (!glassAvailable) {
      navigation.setOptions({ headerShown: false });
      return;
    }
    navigation.setOptions({
      // As Activities: the title is a native leading item on the bar row,
      // beside the trailing items, so no empty row sits above a large title.
      // An empty navigation title stops iOS 26 adding its centred one.
      title: "",
      headerShown: true,
      headerLargeTitle: false,
      // The system bar background: the list scrolls under it with iOS 26's
      // scroll-edge effect, never an opaque page-coloured block.
      headerTransparent: true,
      headerShadowVisible: false,
      // Removed on Companies: the native bar has no inert state.
      headerSearchBarOptions: searchable
        ? {
            placeholder: t("diarySearchPlaceholder"),
            autoCapitalize: "none",
            hideWhenScrolling: true,
            allowToolbarIntegration: false,
            placement: "integratedButton",
            onChangeText: (event: { nativeEvent: { text: string } }) =>
              setQuery(event.nativeEvent.text),
            onCancelButtonPress: () => {
              setQuery("");
            },
          }
        : undefined,
    });
  }, [glassAvailable, navigation, searchable, t]);

  const noteInitial =
    noteTarget?.kind === "person"
      ? noteTarget.entry.note
      : noteTarget?.kind === "company"
        ? (collection?.items.find((item) => item.enterpriseId === noteTarget.enterpriseId)?.entry
            ?.note ?? null)
        : null;

  // One note editor for people and stands; a stand's opens inside the
  // company sheet so iOS can stack it over that sheet.
  const noteEditor = (
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
  );

  const list = (
    <ScrollView
      ref={scrollRef}
      {...trueTop.scrollProps}
      testID="diary-scroll"
      accessibilityElementsHidden={inputOpen}
      importantForAccessibility={inputOpen ? "no-hide-descendants" : "auto"}
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{
        gap: 16,
        padding: 16,
        paddingBottom: Math.max(32, tabBarBottomInset + 16),
        paddingTop: 8,
      }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />}
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
        values={SECTIONS.map((key) => sectionLabels[key])}
        selectedIndex={Math.max(0, SECTIONS.indexOf(section))}
        onChange={(index) => selectSection(SECTIONS[index] ?? "people")}
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
          {loadError ? <RequestFeedback error={loadError} onRetry={() => void load()} /> : null}
          {entries === null ? (
            loadError ? null : (
              <RequestFeedback loading={loading} error={null} onRetry={() => void load()} />
            )
          ) : entries.length === 0 ? (
            <EmptyState icon="person.2.crop.square.stack" title={t("diaryEmptyTitle")} />
          ) : visible.length === 0 ? (
            activeFavourites && !activeQuery.trim() ? (
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
    </ScrollView>
  );
  const celebrationSelf = {
    name: [me?.name, me?.surname].filter(Boolean).join(" ") || (me?.email ?? ""),
    image: me?.image ?? null,
  };
  const overlays = (
    <>
      <ConnectionCelebration
        target={input === "qr" ? null : celebration}
        self={celebrationSelf}
        onCovered={revealMet}
        onDone={finishCelebration}
      />
      <WalletModal wallet={wallet} />
      <NfcReader
        visible={input === "nfc"}
        onValue={(uid) => void submitScan(uid)}
        onClose={() => setInput(null)}
      />
      <ScannerCodeEntry
        visible={input === "manual"}
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
            onValue={(code) => void submitScan(code, true)}
          />
        ) : null}
        <ConnectionCelebration
          inline
          target={input === "qr" ? celebration : null}
          self={celebrationSelf}
          onCovered={revealMet}
          onDone={finishCelebration}
        />
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
      >
        {noteTarget?.kind === "company" ? noteEditor : null}
      </CompanySheet>
      {noteTarget?.kind === "company" ? null : noteEditor}
    </>
  );

  // iOS 26: the scroll view is the screen's first child, below the native bar.
  if (glassAvailable) {
    return (
      <>
        {list}
        <Stack.Toolbar placement="left">
          <Stack.Toolbar.View hidesSharedBackground>
            <Text
              accessibilityRole="header"
              maxFontSizeMultiplier={CHROME_MAX_FONT_SIZE_MULTIPLIER}
              style={{
                // A fixed colour, not the dynamic label: iOS 26 flips a bar
                // item's light/dark appearance with what scrolls behind it,
                // which turned the title white over the blue scan pill.
                color: colorScheme === "dark" ? "#ffffff" : "#000000",
                fontSize: 28,
                fontWeight: "800",
              }}
            >
              {t("tabDiary")}
            </Text>
          </Stack.Toolbar.View>
        </Stack.Toolbar>
        {/* Native SF Symbol bar items, so the system draws the same circles as its search button. */}
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button
            icon="wallet.pass"
            separateBackground
            accessibilityLabel={t("tabWallet")}
            onPress={wallet.toggle}
          />
          {searchable ? (
            <Stack.Toolbar.Button
              icon={favouritesOnly ? "star.fill" : "star"}
              accessibilityLabel={t("diaryShowFavourites")}
              selected={favouritesOnly}
              tintColor={favouritesOnly ? colors.warning : undefined}
              onPress={toggleFavourites}
            />
          ) : null}
        </Stack.Toolbar>
        {overlays}
      </>
    );
  }
  return (
    <View style={{ backgroundColor: colors.background, flex: 1 }}>
      <LegacyScreenHeader
        actions={
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <GlassView
              colorScheme="auto"
              glassEffectStyle="regular"
              isInteractive
              style={{ borderRadius: 22, height: 44, width: 44 }}
            >
              <WalletToggle onToggle={wallet.toggle} />
            </GlassView>
            {searchable ? (
              <GlassView
                colorScheme="auto"
                glassEffectStyle="regular"
                isInteractive
                style={{ borderRadius: 22, flexDirection: "row", height: 44 }}
              >
                <FavouritesToggle visible on={favouritesOnly} onToggle={toggleFavourites} />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("scheduleSearch")}
                  onPress={() => setSearchOpen(true)}
                  style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
                >
                  <SymbolView
                    accessible={false}
                    name="magnifyingglass"
                    size={19}
                    tintColor={colors.label}
                  />
                </Pressable>
              </GlassView>
            ) : null}
          </View>
        }
        showSearchButton={false}
        cancelLabel={t("cancel")}
        onCloseSearch={() => {
          setSearchOpen(false);
          setQuery("");
        }}
        onOpenSearch={() => setSearchOpen(true)}
        onSearchQueryChange={setQuery}
        searchEnabled={searchable}
        searchLabel={t("scheduleSearch")}
        searchOpen={searchOpen}
        searchPlaceholder={t("diarySearchPlaceholder")}
        searchQuery={query}
        title={t("tabDiary")}
        topInset={legacyTopInset}
      />
      {list}
      {overlays}
    </View>
  );
}

/** The favourites filter (#935) in `LegacyScreenHeader`, on People only. */
function FavouritesToggle({
  visible,
  on,
  onToggle,
}: {
  visible: boolean;
  on: boolean;
  onToggle: () => void;
}) {
  const { t } = useLocale();
  if (!visible) return null;
  return (
    <Pressable
      accessibilityRole="togglebutton"
      accessibilityLabel={t("diaryShowFavourites")}
      accessibilityState={{ checked: on }}
      onPress={onToggle}
      style={({ pressed }) => ({
        alignItems: "center",
        height: 44,
        justifyContent: "center",
        opacity: pressed ? 0.6 : 1,
        width: 44,
      })}
    >
      {/* Material Symbols ship only an outlined star; this one also fills. */}
      <FavouriteStar on={on} />
    </Pressable>
  );
}

/** The wallet (badge QR) button in `LegacyScreenHeader`, beside the favourites star. */
function WalletToggle({ onToggle }: { onToggle: () => void }) {
  const { t } = useLocale();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("tabWallet")}
      onPress={onToggle}
      style={({ pressed }) => ({
        alignItems: "center",
        height: 44,
        justifyContent: "center",
        opacity: pressed ? 0.6 : 1,
        width: 44,
      })}
    >
      <SymbolView accessible={false} name="wallet.pass" size={19} tintColor={colors.label} />
    </Pressable>
  );
}
