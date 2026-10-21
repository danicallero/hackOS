import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import Stack from "expo-router/stack";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { Platform, ScrollView, Text, TextInput, View } from "react-native";
import { isRealLiquidGlassAvailable } from "@/components/glass-view";
import { ActionButton, EmptyState, Section, Separator } from "@/components/native-ui";
import { PressableFeedback } from "@/components/pressable-feedback";
import { CircleButton } from "@/components/project-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { apiFetch } from "@/lib/api";
import { authorizeGithubForProject, type GithubRepoCandidate } from "@/lib/github";
import { haptic } from "@/lib/haptics";
import { useLocale } from "@/lib/i18n";
import { projectMutation } from "@/lib/projects";
import { colors, radius, type } from "@/theme";
import { useParticipantLayout } from "@/theme/layout-participant";

/**
 * H18: pick the repository a project links, in a sheet like Select challenges.
 * Choosing one links it and closes; with none shared yet the sheet offers the
 * GitHub authorization instead.
 */
export function ProjectGithubScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useLocale();
  const readable = useParticipantLayout("form");
  const navigation = useNavigation();
  const router = useRouter();
  const glass = isRealLiquidGlassAvailable();
  const base = `/api/me/projects/${id}/github`;
  const [repos, setRepos] = useState<GithubRepoCandidate[] | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    try {
      setRepos((await apiFetch<{ repos: GithubRepoCandidate[] }>(`${base}/repos`)).repos);
      setError(null);
    } catch (cause) {
      setRepos((current) => current ?? []);
      setError(cause as Error);
    }
  }, [base]);
  useEffect(() => {
    void load();
  }, [load]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: t("githubChooseRepo"),
      headerLargeTitle: false,
      headerShadowVisible: false,
      // iOS 26 draws the native toolbar button below as a glass circle.
      headerLeft: undefined,
      headerRight: glass
        ? undefined
        : () => (
            <CircleButton icon="xmark" label={t("close")} prominent onPress={() => router.back()} />
          ),
      ...(Platform.OS === "ios"
        ? {
            headerSearchBarOptions: {
              placeholder: t("githubSearchRepos"),
              autoCapitalize: "none",
              hideWhenScrolling: false,
              onChangeText: (event: { nativeEvent: { text: string } }) =>
                setQuery(event.nativeEvent.text),
            },
          }
        : {}),
    });
  });

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause as Error);
    } finally {
      setBusy(false);
    }
  }
  const choose = (repo: GithubRepoCandidate) =>
    run(async () => {
      await projectMutation(`${base}/repo`, "PUT", { githubRepoId: repo.id });
      void haptic("selection");
      router.back();
    });
  const authorize = (authorizeAccount: boolean) =>
    run(async () => {
      if (await authorizeGithubForProject(Number(id), authorizeAccount)) await load();
    });

  const needle = query.trim().toLowerCase();
  const shown = (repos ?? []).filter(
    (repo) => !needle || repo.fullName.toLowerCase().includes(needle),
  );
  return (
    <>
      {glass ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button
            separateBackground
            icon="xmark"
            accessibilityLabel={t("close")}
            onPress={() => router.back()}
          />
        </Stack.Toolbar>
      ) : null}
      <ScrollView
        alwaysBounceVertical
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          gap: 24,
          paddingVertical: 16,
          ...readable.content,
          paddingBottom: 32,
        }}
      >
        {Platform.OS !== "ios" ? (
          <TextInput
            accessibilityLabel={t("githubSearchRepos")}
            value={query}
            onChangeText={setQuery}
            placeholder={t("githubSearchRepos")}
            placeholderTextColor={colors.tertiaryLabel}
            style={{
              backgroundColor: colors.surface,
              borderRadius: radius.container,
              color: colors.label,
              fontSize: type.body.fontSize,
              minHeight: 44,
              paddingHorizontal: 16,
            }}
          />
        ) : null}
        {error ? <RequestFeedback error={error} /> : null}
        {repos === null ? <RequestFeedback loading /> : null}
        {shown.length > 0 ? (
          <Section>
            {shown.map((repo, index) => (
              <View key={repo.id}>
                {index > 0 ? <Separator /> : null}
                <PressableFeedback
                  feedback="row"
                  accessibilityRole="button"
                  accessibilityLabel={repo.fullName}
                  disabled={busy}
                  onPress={() => void choose(repo)}
                  style={{
                    justifyContent: "center",
                    minHeight: 50,
                    opacity: busy ? 0.5 : 1,
                    paddingHorizontal: 16,
                    paddingVertical: 10,
                  }}
                >
                  <Text style={{ color: colors.label, fontSize: type.body.fontSize }}>
                    {repo.fullName}
                  </Text>
                </PressableFeedback>
              </View>
            ))}
          </Section>
        ) : null}
        {repos && repos.length === 0 && !error ? (
          <EmptyState icon="tray" title={t("githubNoRepos")} />
        ) : null}
        {repos && !needle ? (
          <Section>
            <ActionButton
              label={repos.length ? t("githubShareMoreRepos") : t("githubLinkRepo")}
              icon="link"
              disabled={busy}
              busy={busy}
              onPress={() => void authorize(repos.length === 0)}
            />
          </Section>
        ) : null}
      </ScrollView>
    </>
  );
}
