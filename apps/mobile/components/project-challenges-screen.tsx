import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import Stack from "expo-router/stack";
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { isRealLiquidGlassAvailable } from "@/components/glass-view";
import { EmptyState, Section, Separator } from "@/components/native-ui";
import { CircleButton } from "@/components/project-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { SymbolView } from "@/components/symbol";
import { apiFetch } from "@/lib/api";
import { haptic } from "@/lib/haptics";
import { useLocale } from "@/lib/i18n";
import { fetchChallengeCatalogue, type NativeProject, projectMutation } from "@/lib/projects";
import { colors } from "@/theme/colors";

type Chosen = NativeProject["challenges"];

/**
 * H21: pick the challenges a project competes in, in a sheet like Invite
 * teammate. Each tap saves at once, so the sheet only needs Done. Mandatory
 * challenges are pinned first and locked; the rest scale with native search.
 */
export function ProjectChallengesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, language } = useLocale();
  const navigation = useNavigation();
  const router = useRouter();
  const glass = isRealLiquidGlassAvailable();
  const [all, setAll] = useState<{ id: number; title: string }[] | null>(null);
  const [chosen, setChosen] = useState<Chosen>([]);
  const [editable, setEditable] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<Error | null>(null);
  const load = useCallback(async () => {
    try {
      const [challenges, project] = await Promise.all([
        fetchChallengeCatalogue(language),
        apiFetch<NativeProject>(`/api/me/projects/${id}`),
      ]);
      setAll(challenges);
      setChosen(project.challenges);
      setEditable(project.canEdit === true);
      setError(null);
    } catch (cause) {
      setAll((current) => current ?? []);
      setError(cause as Error);
    }
  }, [id, language]);
  useEffect(() => {
    void load();
  }, [load]);
  useLayoutEffect(() => {
    navigation.setOptions({
      title: t("projectChallenges"),
      headerLargeTitle: false,
      headerShadowVisible: false,
      // iOS 26 draws the native toolbar button below as a glass circle.
      headerLeft: undefined,
      headerRight: glass
        ? undefined
        : () => (
            <CircleButton
              icon="checkmark"
              label={t("close")}
              prominent
              onPress={() => router.back()}
            />
          ),
      ...(Platform.OS === "ios"
        ? {
            headerSearchBarOptions: {
              placeholder: t("projectSearchChallenges"),
              autoCapitalize: "none",
              hideWhenScrolling: false,
              onChangeText: (event: { nativeEvent: { text: string } }) =>
                setQuery(event.nativeEvent.text),
            },
          }
        : {}),
    });
  });
  async function toggle(challenge: { id: number; title: string }, selected: boolean) {
    const before = chosen;
    setError(null);
    setChosen(
      selected
        ? chosen.filter((item) => item.id !== challenge.id)
        : [...chosen, { id: challenge.id, title: challenge.title }],
    );
    try {
      await projectMutation(
        `/api/me/projects/${id}/challenges/${challenge.id}`,
        selected ? "DELETE" : "PUT",
      );
      void haptic("selection");
      // The server's project is the truth: reflect exactly what it stored.
      const fresh = await apiFetch<NativeProject>(`/api/me/projects/${id}`);
      setChosen(fresh.challenges);
    } catch (cause) {
      setChosen(before);
      // The server list is the truth (phase closed, already chosen); keep the reason visible.
      await load();
      setError(cause as Error);
    }
  }
  const needle = query.trim().toLowerCase();
  const matches = (title: string) => !needle || title.toLowerCase().includes(needle);
  const required = chosen.filter((item) => item.mandatory && matches(item.title));
  const chosenIds = useMemo(() => new Set(chosen.map((item) => item.id)), [chosen]);
  const rest = useMemo(
    () =>
      (all ?? [])
        .filter((item) => !chosen.some((c) => c.id === item.id && c.mandatory))
        // Catalogue order, never selection order: a checkmark changes, the row stays.
        .filter((item) => matches(item.title)),
    // biome-ignore lint/correctness/useExhaustiveDependencies: matches closes over needle
    [all, chosen, matches],
  );
  const row = (title: string, selected: boolean, locked: boolean, onPress?: () => void) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ selected, disabled: locked || !editable }}
      disabled={locked || !editable}
      onPress={onPress}
      style={{
        alignItems: "center",
        flexDirection: "row",
        gap: 12,
        minHeight: 50,
        opacity: !editable && !selected ? 0.5 : 1,
        paddingHorizontal: 16,
        paddingVertical: 10,
      }}
    >
      <Text style={{ color: colors.label, flex: 1, fontSize: 17 }}>{title}</Text>
      {locked ? (
        <SymbolView
          name="lock.fill"
          tintColor={colors.tertiaryLabel}
          size={15}
          accessible={false}
        />
      ) : selected ? (
        <SymbolView
          name="checkmark"
          tintColor={colors.accent}
          size={17}
          weight="semibold"
          accessible={false}
        />
      ) : null}
    </Pressable>
  );
  return (
    <>
      {glass ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button
            separateBackground
            variant="prominent"
            icon="checkmark"
            accessibilityLabel={t("close")}
            onPress={() => router.back()}
          />
        </Stack.Toolbar>
      ) : null}
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ gap: 24, padding: 16, paddingBottom: 32 }}
      >
        {Platform.OS !== "ios" ? (
          <TextInput
            accessibilityLabel={t("projectSearchChallenges")}
            value={query}
            onChangeText={setQuery}
            placeholder={t("projectSearchChallenges")}
            placeholderTextColor={colors.tertiaryLabel}
            style={{
              backgroundColor: colors.surface,
              borderRadius: 14,
              color: colors.label,
              fontSize: 17,
              minHeight: 44,
              paddingHorizontal: 16,
            }}
          />
        ) : null}
        {error ? <RequestFeedback error={error} /> : null}
        {all === null ? <RequestFeedback loading /> : null}
        {required.length > 0 ? (
          <Section title={t("projectRequired")}>
            {required.map((item, index) => (
              <View key={item.id}>
                {index > 0 ? <Separator /> : null}
                {row(item.title, true, true)}
              </View>
            ))}
          </Section>
        ) : null}
        {rest.length > 0 ? (
          <Section title={required.length > 0 ? t("projectChallenges") : undefined}>
            {rest.map((item, index) => (
              <View key={item.id}>
                {index > 0 ? <Separator /> : null}
                {row(
                  item.title,
                  chosenIds.has(item.id),
                  false,
                  () => void toggle(item, chosenIds.has(item.id)),
                )}
              </View>
            ))}
          </Section>
        ) : null}
        {all && required.length === 0 && rest.length === 0 && !error ? (
          <EmptyState icon="magnifyingglass" title={t("projectNoGallery")} />
        ) : null}
      </ScrollView>
    </>
  );
}
