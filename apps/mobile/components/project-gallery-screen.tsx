import { useFocusEffect, useNavigation, useRouter } from "expo-router";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Platform, Pressable, ScrollView, TextInput, View } from "react-native";
import { ActionButton, EmptyState, InfoRow, Section, StatusPill } from "@/components/native-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { SegmentedControl } from "@/components/segmented-control";
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
  const [challengeId, setChallengeId] = useState<number | null>(null);
  const [challenges, setChallenges] = useState<{ id: number; title: string }[]>([]);
  const [projects, setProjects] = useState<NativeProject[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const generation = useRef(0);
  useLayoutEffect(() => {
    if (Platform.OS !== "ios") return;
    navigation.setOptions({
      headerSearchBarOptions: {
        placeholder: t("projectSearch"),
        autoCapitalize: "none",
        hideWhenScrolling: true,
        allowToolbarIntegration: false,
        placement: "integratedButton",
        onChangeText: (event: { nativeEvent: { text: string } }) =>
          setSearch(event.nativeEvent.text),
      },
    });
  }, [navigation, t]);
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
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 32 }}
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
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{ width: Math.max(320, (challenges.length + 1) * 180) }}>
          <SegmentedControl
            label={t("projectChallenges")}
            values={[t("projectAllChallenges"), ...challenges.map((item) => item.title)]}
            selectedIndex={
              challengeId === null ? 0 : challenges.findIndex((item) => item.id === challengeId) + 1
            }
            onChange={(index) => setChallengeId(index === 0 ? null : challenges[index - 1].id)}
          />
        </View>
      </ScrollView>
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
      {projects.map((project) => (
        <Section key={project.id}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={project.name}
            onPress={() =>
              router.push({
                pathname: "/projects/[id]",
                params: { id: String(project.id), gallery: "1" },
              })
            }
          >
            <InfoRow
              label={project.name}
              value={project.challenges.map((challenge) => challenge.title).join(" · ")}
              accessoryIcon="chevron.right"
            />
          </Pressable>
          {project.winners?.map((winner) => (
            <View
              key={`${winner.challengeId}:${winner.rank}`}
              style={{ paddingHorizontal: 16, paddingBottom: 12 }}
            >
              <StatusPill tone="success">{`${t("projectWinner")} · ${winner.challengeTitle ?? winner.rank}`}</StatusPill>
            </View>
          ))}
        </Section>
      ))}
      {loading ? <RequestFeedback loading /> : null}
      {projects.length < total ? (
        <ActionButton
          label={t("projectMore")}
          disabled={loading}
          onPress={() => void load(page + 1)}
        />
      ) : null}
    </ScrollView>
  );
}
