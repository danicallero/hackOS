import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import Stack from "expo-router/stack";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Platform, Pressable, ScrollView, TextInput, View } from "react-native";
import { FilterMenu, type FilterMenuProps } from "@/components/filter-menu";
import { isRealLiquidGlassAvailable } from "@/components/glass-view";
import { ActionButton, EmptyState, InfoRow, Section, Separator } from "@/components/native-ui";
import { NavRow } from "@/components/project-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { ApiError, apiFetch } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import type { GalleryPage, NativeProject } from "@/lib/projects";
import { colors } from "@/theme/colors";

/** H18: audience and publication policy remain entirely server-owned; no persistent gallery cache. */
export function ProjectGalleryScreen() {
  const { t } = useLocale();
  const router = useRouter();
  const navigation = useNavigation();
  const [search, setSearch] = useState("");
  const params = useLocalSearchParams<{ challengeId?: string }>();
  const [challengeId, setChallengeId] = useState<number | null>(
    params.challengeId ? Number(params.challengeId) : null,
  );
  const [challenges, setChallenges] = useState<{ id: number; title: string }[]>([]);
  const [projects, setProjects] = useState<NativeProject[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const generation = useRef(0);
  const glassAvailable = isRealLiquidGlassAvailable();
  const filterItems: FilterMenuProps["items"] = [
    ...challenges.map((item) => ({
      id: String(item.id),
      label: item.title,
      selected: item.id === challengeId,
    })),
    ...(challengeId !== null
      ? [{ id: "all", label: t("projectAllChallenges"), selected: false }]
      : []),
  ];
  const selectChallenge = (id: string) => setChallengeId(id === "all" ? null : Number(id));
  const filter = (
    <FilterMenu
      accessibilityLabel={t("projectChallenges")}
      active={challengeId !== null}
      items={filterItems}
      onSelect={selectChallenge}
    />
  );
  useLayoutEffect(() => {
    navigation.setOptions({
      title: t("gallery"),
      headerShown: true,
      headerLargeTitle: true,
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
    async (nextPage = 1) => {
      const request = ++generation.current;
      setLoading(true);
      setError(null);
      if (nextPage === 1) {
        setProjects([]);
        setTotal(0);
      }
      try {
        const query = new URLSearchParams({
          page: String(nextPage),
          pageSize: "20",
          search: search.trim(),
        });
        if (challengeId !== null) query.set("challengeId", String(challengeId));
        const result = await apiFetch<GalleryPage>(`/api/public/projects?${query}`);
        if (request !== generation.current) return;
        setProjects((current) => (nextPage === 1 ? result.items : [...current, ...result.items]));
        setPage(nextPage);
        setTotal(result.total);
      } catch (cause) {
        if (request === generation.current) {
          setError(cause as Error);
          setProjects([]);
        }
      } finally {
        if (request === generation.current) setLoading(false);
      }
    },
    [search, challengeId],
  );
  useEffect(() => {
    void apiFetch<{ id: number; title: string }[]>("/api/public/challenges")
      .then(setChallenges)
      .catch(() => {});
  }, []);
  useFocusEffect(
    useCallback(() => {
      const timer = setTimeout(() => {
        void load();
      }, 250);
      const poll = setInterval(() => {
        void load();
      }, 15000);
      return () => {
        clearTimeout(timer);
        clearInterval(poll);
        generation.current += 1;
        setProjects([]);
      };
    }, [load]),
  );
  return (
    <>
      {glassAvailable && challenges.length > 0 ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.View hidesSharedBackground>{filter}</Stack.Toolbar.View>
        </Stack.Toolbar>
      ) : null}
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 16, gap: 20, paddingBottom: 32 }}
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
        {challengeId !== null ? (
          <Section>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("projectAllChallenges")}
              onPress={() => setChallengeId(null)}
            >
              <InfoRow
                icon="line.3.horizontal.decrease.circle.fill"
                label={t("projectChallenges")}
                value={challenges.find((item) => item.id === challengeId)?.title ?? ""}
                accessoryIcon="xmark.circle.fill"
              />
            </Pressable>
          </Section>
        ) : null}
        {error ? (
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
              <View key={project.id}>
                {index > 0 ? <Separator /> : null}
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
                  onPress={() =>
                    router.push({
                      pathname: "/projects/[id]",
                      params: { id: String(project.id), gallery: "1" },
                    })
                  }
                />
              </View>
            ))}
          </Section>
        ) : null}
        {loading ? <RequestFeedback loading /> : null}
        {projects.length < total ? (
          <ActionButton
            label={t("projectMore")}
            disabled={loading}
            onPress={() => void load(page + 1)}
          />
        ) : null}
      </ScrollView>
    </>
  );
}
