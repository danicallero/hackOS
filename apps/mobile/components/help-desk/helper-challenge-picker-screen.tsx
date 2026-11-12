import { useRouter } from "expo-router";
import { useState } from "react";
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

/**
 * H61: which challenges alert this helper, in the same searchable sheet as the
 * request's challenge picker. Rows edit a draft; the checkmark saves it and
 * Close leaves the profile as it was. No challenge chosen means every request.
 */
export function HelperChallengePickerScreen() {
  const { t } = useLocale();
  const router = useRouter();
  const result = useHelpResource<MyHelperProfile<DirectoryEntry>>("/api/me/helper-profile");
  const [query, setQuery] = useState("");
  // Null until a row is touched, so the saved choice shows as soon as it loads.
  const [draft, setDraft] = useState<number[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<Error | null>(null);

  const profile = result.data;
  const selected = draft ?? profile?.challengeIds ?? [];
  const inert = busy || !profile;
  const needle = query.trim().toLocaleLowerCase();
  const matching = (profile?.challengeOptions ?? []).filter(
    (challenge) => !needle || challenge.name.toLocaleLowerCase().includes(needle),
  );

  function choose(next: number[]) {
    void haptic("selection");
    setDraft(next);
  }

  async function save() {
    if (inert) return;
    if (draft === null) {
      router.back();
      return;
    }
    setBusy(true);
    setSaveError(null);
    try {
      const saved = await helpMutation<MyHelperProfile<DirectoryEntry>>(
        "/api/me/helper-profile",
        {
          published: profile.published,
          topicIds: profile.topics.map((topic) => topic.id),
          challengeIds: draft,
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
      confirmDisabled={inert}
      closeDisabled={busy}
    >
      <RequestFeedback
        loading={result.loading && !profile}
        error={result.error}
        onRetry={() => void result.load()}
      />
      {saveError ? <RequestFeedback error={saveError} onRetry={() => void save()} /> : null}
      {!needle && profile ? (
        <Section>
          <CheckRow
            label={t("helpAlertsAll")}
            selected={selected.length === 0}
            disabled={busy}
            onPress={() => choose([])}
          />
        </Section>
      ) : null}
      {matching.length > 0 ? (
        <Section footer={needle ? undefined : t("helpChallengeAlertsNote")}>
          {matching.map((challenge, index) => {
            const chosen = selected.includes(challenge.id);
            return (
              <View key={challenge.id}>
                {index > 0 ? <Separator /> : null}
                <CheckRow
                  label={challenge.name}
                  selected={chosen}
                  disabled={busy}
                  onPress={() =>
                    choose(
                      chosen
                        ? selected.filter((id) => id !== challenge.id)
                        : [...selected, challenge.id],
                    )
                  }
                />
              </View>
            );
          })}
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
