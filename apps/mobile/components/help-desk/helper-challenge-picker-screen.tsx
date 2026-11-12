import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { EmptyState, Section, Separator } from "@/components/native-ui";
import { NoResultsState } from "@/components/no-results-state";
import { RequestFeedback } from "@/components/RequestFeedback";
import { CheckRow, SearchablePickerSheet } from "@/components/searchable-picker";
import type { DirectoryEntry } from "@/lib/directory";
import { haptic } from "@/lib/haptics";
import { helpMutation, type MyHelperProfile } from "@/lib/help-desk";
import { useLocale } from "@/lib/i18n";
import { useHelpResource } from "@/lib/use-help-resource";

/** H61: searchable multi-select for the helper's challenge alert preferences. */
export function HelperChallengePickerScreen() {
  const { t } = useLocale();
  const router = useRouter();
  const result = useHelpResource<MyHelperProfile<DirectoryEntry>>("/api/me/helper-profile");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<number[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<Error | null>(null);

  useEffect(() => {
    if (result.data) setSelected(result.data.challengeIds);
  }, [result.data]);

  const profile = result.data;
  const needle = query.trim().toLocaleLowerCase();
  const matching = (profile?.challengeOptions ?? []).filter(
    (challenge) => !needle || challenge.name.toLocaleLowerCase().includes(needle),
  );

  function toggle(id: number) {
    if (selected === null) return;
    void haptic("selection");
    setSelected(
      selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id],
    );
  }

  async function save() {
    if (!profile || selected === null || busy) return;
    setBusy(true);
    setSaveError(null);
    try {
      const saved = await helpMutation<MyHelperProfile<DirectoryEntry>>(
        "/api/me/helper-profile",
        {
          published: profile.published,
          topicIds: profile.topics.map((topic) => topic.id),
          challengeIds: selected,
        },
        "PUT",
      );
      result.setData(saved);
      void haptic("success");
      router.back();
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SearchablePickerSheet
      title={t("helpChallengeAlerts")}
      searchPlaceholder={t("helpSearchChallenges")}
      query={query}
      onQuery={setQuery}
      onConfirm={() => void save()}
      confirmDisabled={busy || selected === null}
      closeDisabled={busy}
    >
      <RequestFeedback
        loading={result.loading && !profile}
        error={result.error}
        onRetry={() => void result.load()}
      />
      {saveError ? <RequestFeedback error={saveError} onRetry={() => void save()} /> : null}
      {!needle && profile ? (
        <Section footer={t("helpChallengeAlertsNote")}>
          <CheckRow
            label={t("helpAlertsAll")}
            selected={selected?.length === 0}
            disabled={busy || selected === null}
            onPress={() => {
              void haptic("selection");
              setSelected([]);
            }}
          />
        </Section>
      ) : null}
      {matching.length > 0 ? (
        <Section>
          {matching.map((challenge, index) => (
            <View key={challenge.id}>
              {index > 0 ? <Separator /> : null}
              <CheckRow
                label={challenge.name}
                selected={selected?.includes(challenge.id) ?? false}
                disabled={busy || selected === null}
                onPress={() => toggle(challenge.id)}
              />
            </View>
          ))}
        </Section>
      ) : profile ? (
        needle ? (
          <NoResultsState />
        ) : (
          <EmptyState icon="flag" title={t("mobileStatesNoChallenges")} />
        )
      ) : null}
    </SearchablePickerSheet>
  );
}
