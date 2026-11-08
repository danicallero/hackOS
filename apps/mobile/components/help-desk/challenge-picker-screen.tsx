import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { EmptyState, Section, Separator } from "@/components/native-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { CheckRow, SearchablePickerSheet } from "@/components/searchable-picker";
import { haptic } from "@/lib/haptics";
import { setChallengeSelection, useChallengeSelection } from "@/lib/help-challenge-selection";
import type { HelpChallenge } from "@/lib/help-desk";
import { useLocale } from "@/lib/i18n";
import { useHelpResource } from "@/lib/use-help-resource";

type PickableChallenge = HelpChallenge & { mine?: boolean };

/**
 * H65: the challenge a request is about, in the same searchable sheet as the
 * topic and project challenge pickers. One choice: tapping a row writes it to
 * the form's draft and closes the sheet; "None" clears it. The requester's own
 * project challenges come first.
 */
export function HelpChallengePickerScreen() {
  const { t } = useLocale();
  const router = useRouter();
  const { selected } = useChallengeSelection();
  const [query, setQuery] = useState("");
  const result = useHelpResource<{ challenges: PickableChallenge[] }>("/api/helpdesk/challenges");
  const needle = query.trim().toLocaleLowerCase();
  const matching = (result.data?.challenges ?? []).filter(
    (challenge) => !needle || challenge.name.toLocaleLowerCase().includes(needle),
  );
  const mine = matching.filter((challenge) => challenge.mine);
  const others = matching.filter((challenge) => !challenge.mine);
  function choose(challenge: HelpChallenge | null) {
    void haptic("selection");
    setChallengeSelection(challenge ? { id: challenge.id, name: challenge.name } : null);
    router.back();
  }
  const rows = (list: PickableChallenge[]) =>
    list.map((challenge, index) => (
      <View key={challenge.id}>
        {index > 0 ? <Separator /> : null}
        <CheckRow
          label={challenge.name}
          selected={selected?.id === challenge.id}
          onPress={() => choose(challenge)}
        />
      </View>
    ));
  return (
    <SearchablePickerSheet
      title={t("helpChallenge")}
      searchPlaceholder={t("helpSearchChallenges")}
      query={query}
      onQuery={setQuery}
    >
      <RequestFeedback
        loading={result.loading && !result.data}
        error={result.error}
        onRetry={() => void result.load()}
      />
      {!needle ? (
        <Section>
          <CheckRow
            label={t("helpNoChallenge")}
            selected={!selected}
            onPress={() => choose(null)}
          />
        </Section>
      ) : null}
      {mine.length ? <Section title={t("helpMyChallenges")}>{rows(mine)}</Section> : null}
      {others.length ? (
        <Section title={mine.length ? t("helpAllChallenges") : undefined}>{rows(others)}</Section>
      ) : null}
      {result.data && matching.length === 0 && needle ? (
        <EmptyState icon="magnifyingglass" title={t("helpNoTopics")} />
      ) : null}
    </SearchablePickerSheet>
  );
}
