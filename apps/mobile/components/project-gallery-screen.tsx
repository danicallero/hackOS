import { SSE_TOPICS } from "@hackos/shared/events";
import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import Stack from "expo-router/stack";
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { FilterMenu, type FilterMenuProps } from "@/components/filter-menu";
import { isRealLiquidGlassAvailable } from "@/components/glass-view";
import { EntryBackToolbar } from "@/components/header-back-button";
import { ActionButton, EmptyState, Section, Separator } from "@/components/native-ui";
import { ProjectDetailScreen } from "@/components/project-detail-screen";
import { NavRow } from "@/components/project-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { ApiError, apiFetch } from "@/lib/api";
import { formatEventTime } from "@/lib/event-time";
import { useBookCrease } from "@/lib/fold-region";
import { useLocale } from "@/lib/i18n";
import { useMeContext } from "@/lib/me-context";
import {
  fetchChallengeCatalogue,
  type GalleryPage,
  mergeProjects,
  type NativeProject,
} from "@/lib/projects";
import { useStreamRefresh } from "@/lib/use-stream-refresh";
import { listDetailLayout } from "@/lib/window-size";
import { colors } from "@/theme/colors";

/** H18: a gallery that is not open yet is a date, not a permission error. */
export function galleryClosedNotice(
  error: Error | null,
  t: ReturnType<typeof useLocale>["t"],
  language: ReturnType<typeof useLocale>["language"],
) {
  if (!(error instanceof ApiError) || error.status !== 403) return null;
  const details = error.details as { reason?: string; opensAt?: string | null } | undefined;
  if (!details?.reason?.startsWith("gallery_")) return null;
  if (details.reason !== "gallery_closed" || !details.opensAt) return t("galleryNotOpen");
  return t("galleryOpensOn", {
    date: formatEventTime(details.opensAt, language, { dateStyle: "long", timeStyle: "short" }),
  });
}

interface GallerySnapshot {
  projects: NativeProject[];
  page: number;
  total: number;
  loaded: number;
  at: number;
}

const GalleryRow = memo(function GalleryRow({
  project,
  separated,
  onOpen,
}: {
  project: NativeProject;
  separated: boolean;
  onOpen: (id: number) => void;
}) {
  const { t } = useLocale();
  return (
    <View>
      {separated ? <Separator /> : null}
      <NavRow
        title={project.name}
        lines={[
          ...(project.winners ?? []).map(
            (winner) => `${t("projectWinner")} · ${winner.challengeTitle ?? winner.rank}`,
          ),
          ...(project.challenges.length
            ? [project.challenges.map((challenge) => challenge.title).join(" · ")]
            : []),
        ]}
        onPress={() => onOpen(project.id)}
      />
    </View>
  );
});

/** A visit this recent is shown as is; leaving and coming back must not refetch. */
const FRESH_MS = 30_000;
/** Backup poll, only while a gallery stream is disconnected. */
const POLL_MS = 60_000;

/**
 * H18: audience and publication policy remain entirely server-owned, so the
 * snapshot lives in memory only (never persisted) and is keyed by account.
 */
const snapshots = new Map<string, GallerySnapshot>();

/** Drops every remembered result (tests; the cache is otherwise per account and filter). */
export function clearGallerySnapshots() {
  snapshots.clear();
}

/** H18: audience and publication policy remain entirely server-owned; no persistent gallery cache. */
export function ProjectGalleryScreen() {
  const { t, language } = useLocale();
  const { me } = useMeContext();
  const router = useRouter();
  const navigation = useNavigation();
  const [search, setSearch] = useState("");
  const params = useLocalSearchParams<{ challengeId?: string }>();
  const [challengeIds, setChallengeIds] = useState<number[]>(
    params.challengeId ? [Number(params.challengeId)] : [],
  );
  const [challenges, setChallenges] = useState<{ id: number; title: string }[]>([]);
  const snapshotKey = `${me?.id ?? "anonymous"}|${search.trim()}|${challengeIds.join(",")}`;
  const snapshotKeyRef = useRef(snapshotKey);
  const initial = snapshots.get(snapshotKey);
  const [projects, setProjects] = useState<NativeProject[]>(initial?.projects ?? []);
  const [page, setPage] = useState(initial?.page ?? 1);
  const [total, setTotal] = useState(initial?.total ?? 0);
  const [loaded, setLoaded] = useState(initial?.loaded ?? 0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const generation = useRef(0);
  const glassAvailable = isRealLiquidGlassAvailable();
  const filterItems: FilterMenuProps["items"] = [
    ...challenges.map((item) => ({
      id: String(item.id),
      label: item.title,
      selected: challengeIds.includes(item.id),
    })),
    ...(challengeIds.length > 0
      ? [{ id: "all", label: t("projectAllChallenges"), selected: false }]
      : []),
  ];
  const selectChallenge = (id: string) =>
    setChallengeIds((current) =>
      id === "all"
        ? []
        : current.includes(Number(id))
          ? current.filter((value) => value !== Number(id))
          : [...current, Number(id)],
    );
  const filter = (
    <FilterMenu
      accessibilityLabel={t("projectChallenges")}
      active={challengeIds.length > 0}
      items={filterItems}
      onSelect={selectChallenge}
    />
  );

  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const crease = useBookCrease();
  const paneLayout = listDetailLayout(windowWidth, windowHeight, Platform.OS, crease);
  const twoPane = paneLayout.enabled;
  useLayoutEffect(() => {
    navigation.setOptions({
      title: t("gallery"),
      headerShown: true,
      headerLargeTitle: Platform.OS === "ios",
      headerBlurEffect: "none",
      // Android has no large-title bar or content inset: a transparent header there floats over the list.
      headerTransparent: Platform.OS === "ios",
      headerStyle: { backgroundColor: Platform.OS === "ios" ? "transparent" : colors.background },
      scrollEdgeEffects: { top: "hidden", bottom: "hidden", left: "hidden", right: "hidden" },
      headerLargeTitleShadowVisible: false,
      headerShadowVisible: false,
      headerRight: glassAvailable || challenges.length === 0 ? undefined : () => filter,
      ...(Platform.OS === "ios"
        ? {
            headerSearchBarOptions: {
              placeholder: t("projectSearch"),
              autoCapitalize: "none",
              hideWhenScrolling: false,
              allowToolbarIntegration: false,
              placement: "integratedButton",
              onChangeText: (event: { nativeEvent: { text: string } }) =>
                setSearch(event.nativeEvent.text),
            },
          }
        : {}),
    });
  });
  const load = useCallback(
    async (nextPage = 1, quiet = false) => {
      const request = ++generation.current;
      const key = snapshotKey;
      snapshotKeyRef.current = key;
      if (!quiet) setLoading(true);
      setError(null);
      try {
        const fetchPage = async (pageNumber: number) => {
          const query = new URLSearchParams({
            page: String(pageNumber),
            pageSize: "20",
            search: search.trim(),
          });
          // The API filters by one challenge; several are matched here against each project's own list.
          if (challengeIds.length === 1) query.set("challengeId", String(challengeIds[0]));
          const result = await apiFetch<GalleryPage>(`/api/public/projects?${query}`);
          const items =
            challengeIds.length > 1
              ? result.items.filter((item) =>
                  item.challenges.some((challenge) => challengeIds.includes(challenge.id)),
                )
              : result.items;
          return { items, count: result.items.length, total: result.total };
        };
        const previous = snapshots.get(key);
        // A quiet refresh re-reads every page already shown, so it never drops loaded rows.
        const pageNumbers =
          quiet && nextPage === 1
            ? Array.from({ length: previous?.page ?? 1 }, (_, index) => index + 1)
            : [nextPage];
        let fetched: NativeProject[] = [];
        let fetchedCount = 0;
        let latestTotal = 0;
        for (const pageNumber of pageNumbers) {
          const result = await fetchPage(pageNumber);
          if (request !== generation.current) return;
          fetched = [...fetched, ...result.items];
          fetchedCount += result.count;
          latestTotal = result.total;
        }
        const lastPage = pageNumbers[pageNumbers.length - 1] ?? nextPage;
        const append = nextPage > 1;
        const nextProjects = append ? [...(previous?.projects ?? []), ...fetched] : fetched;
        const nextLoaded = (append ? (previous?.loaded ?? 0) : 0) + fetchedCount;
        snapshots.set(key, {
          projects: nextProjects,
          page: lastPage,
          total: latestTotal,
          loaded: nextLoaded,
          at: Date.now(),
        });
        setProjects((current) => mergeProjects(current, nextProjects));
        setLoaded(nextLoaded);
        setPage(lastPage);
        setTotal(latestTotal);
      } catch (cause) {
        if (request !== generation.current) return;
        // A failed quiet refresh keeps what is on screen, except a policy change.
        if (!quiet || (cause instanceof ApiError && cause.status === 403)) {
          setError(cause as Error);
          setProjects([]);
          snapshots.delete(key);
        }
      } finally {
        if (request === generation.current) setLoading(false);
      }
    },
    [search, challengeIds, snapshotKey],
  );
  useEffect(() => {
    void fetchChallengeCatalogue(language)
      .then(setChallenges)
      .catch(() => {});
  }, [language]);
  // A new filter swaps in its remembered result at once, or empties until it loads.
  useEffect(() => {
    if (snapshotKeyRef.current === snapshotKey) return;
    snapshotKeyRef.current = snapshotKey;
    const known = snapshots.get(snapshotKey);
    setProjects(known?.projects ?? []);
    setPage(known?.page ?? 1);
    setTotal(known?.total ?? 0);
    setLoaded(known?.loaded ?? 0);
  }, [snapshotKey]);
  const refreshQuietly = useCallback(() => {
    void load(1, true);
    void fetchChallengeCatalogue(language)
      .then(setChallenges)
      .catch(() => {});
  }, [load, language]);
  const streamDown = useStreamRefresh(refreshQuietly, {
    publicContent: true,
    domains: [SSE_TOPICS.PROJECTS, SSE_TOPICS.DIRECTORY],
  });
  useFocusEffect(
    useCallback(() => {
      const known = snapshots.get(snapshotKey);
      const fresh = known !== undefined && Date.now() - known.at < FRESH_MS;
      const timer = fresh
        ? undefined
        : setTimeout(() => {
            void load(1, known !== undefined);
          }, 250);
      // Backup only while a stream is down; connected streams drive every refresh.
      const poll = setInterval(() => {
        if (snapshots.has(snapshotKey) && streamDown()) void load(1, true);
      }, POLL_MS);
      return () => {
        clearTimeout(timer);
        clearInterval(poll);
      };
    }, [load, snapshotKey, streamDown]),
  );
  // An expanded window shows the project beside the list instead of pushing a route.
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const openProject = useCallback(
    (id: number) =>
      twoPane
        ? setSelectedId(id)
        : router.push({ pathname: "/projects/[id]", params: { id: String(id), gallery: "1" } }),
    [router, twoPane],
  );
  const closed = galleryClosedNotice(error, t, language);
  const showDetailPane = twoPane && projects.length > 0;
  const empty = !loading && projects.length === 0;
  return (
    <>
      <EntryBackToolbar fallback="/(tabs)/queue" />
      {glassAvailable && challenges.length > 0 ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.View hidesSharedBackground>{filter}</Stack.Toolbar.View>
        </Stack.Toolbar>
      ) : null}
      <View style={{ flex: 1, flexDirection: "row" }}>
        <View
          style={{
            flex: showDetailPane ? 0 : 1,
            width: showDetailPane ? paneLayout.listWidth : undefined,
          }}
        >
          <ScrollView
            contentInsetAdjustmentBehavior="automatic"
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{
              padding: 16,
              gap: 20,
              paddingBottom: empty ? 96 : 32,
              flexGrow: 1,
              justifyContent: empty ? "center" : undefined,
            }}
          >
            {Platform.OS !== "ios" ? (
              <TextInput
                accessibilityLabel={t("projectSearch")}
                value={search}
                onChangeText={setSearch}
                placeholder={t("projectSearch")}
                placeholderTextColor={colors.tertiaryLabel}
                style={{
                  color: colors.label,
                  padding: 12,
                  minHeight: 44,
                  fontSize: 17,
                  backgroundColor: colors.surface,
                  borderRadius: 8,
                }}
              />
            ) : null}
            {closed ? (
              <EmptyState icon="clock" title={closed} />
            ) : error ? (
              <RequestFeedback
                error={error}
                onRetry={
                  error instanceof ApiError && error.status === 403 ? undefined : () => void load()
                }
              />
            ) : null}
            {!loading && !error && projects.length === 0 ? (
              <EmptyState icon="hammer" title={t("projectNoGallery")} />
            ) : null}
            {projects.length > 0 ? (
              <Section>
                {projects.map((project, index) => (
                  <GalleryRow
                    key={project.id}
                    project={project}
                    separated={index > 0}
                    onOpen={openProject}
                  />
                ))}
              </Section>
            ) : null}
            {loading ? <RequestFeedback loading compact={projects.length > 0} /> : null}
            {loaded < total ? (
              <ActionButton
                label={t("projectMore")}
                disabled={loading}
                onPress={() => void load(page + 1)}
              />
            ) : null}
          </ScrollView>
        </View>
        {showDetailPane ? (
          <View
            style={{
              borderLeftColor: colors.separator,
              borderLeftWidth: StyleSheet.hairlineWidth,
              flex: 1,
              paddingLeft: paneLayout.gutter,
            }}
          >
            {selectedId !== null ? (
              <ProjectDetailScreen embedded gallery="1" id={String(selectedId)} />
            ) : (
              <View style={{ flex: 1, justifyContent: "center", padding: 24 }}>
                <EmptyState icon="hammer" title={t("gallery")} />
              </View>
            )}
          </View>
        ) : null}
      </View>
    </>
  );
}
