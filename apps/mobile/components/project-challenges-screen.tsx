import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { EmptyState, Section, Separator } from "@/components/native-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { CheckRow, SearchablePickerSheet } from "@/components/searchable-picker";
import { apiFetch } from "@/lib/api";
import { haptic } from "@/lib/haptics";
import { useLocale } from "@/lib/i18n";
import { fetchChallengeCatalogue, type NativeProject, projectMutation } from "@/lib/projects";

type Chosen = NativeProject["challenges"];

/**
 * H21: pick the challenges a project competes in, in a sheet like Invite
 * teammate. Each tap saves at once, so the sheet only needs Done. Mandatory
 * challenges are pinned first and locked; the rest scale with native search.
 */
export function ProjectChallengesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, language } = useLocale();
  const [all, setAll] = useState<{ id: number; title: string }[] | null>(null);
  const [chosen, setChosen] = useState<Chosen>([]);
  const [editable, setEditable] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
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
      setError(cause as Error);
    } finally {
      setLoading(false);
    }
  }, [id, language]);
  useEffect(() => {
    void load();
  }, [load]);
  async function toggle(challenge: { id: number; title: string }, selected: boolean) {
    if (saving || !editable) return;
    setSaving(true);
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
    } finally {
      setSaving(false);
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
    <CheckRow
      label={title}
      selected={selected}
      locked={locked}
      disabled={!editable || saving}
      onPress={onPress}
    />
  );
  return (
    <SearchablePickerSheet
      title={t("projectChallenges")}
      searchPlaceholder={t("projectSearchChallenges")}
      query={query}
      onQuery={setQuery}
    >
      {saving ? <RequestFeedback loading compact /> : null}
      {error ? (
        <RequestFeedback error={error} onRetry={() => void load()} retrying={loading || saving} />
      ) : null}
      {all === null && loading && !error ? <RequestFeedback loading /> : null}
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
    </SearchablePickerSheet>
  );
}
