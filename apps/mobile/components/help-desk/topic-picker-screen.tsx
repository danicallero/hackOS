import { useEffect, useState } from "react";
import { View } from "react-native";
import { EmptyState, Section, Separator } from "@/components/native-ui";
import { NavRow } from "@/components/project-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { CheckRow, SearchablePickerSheet } from "@/components/searchable-picker";
import { apiFetch } from "@/lib/api";
import { haptic } from "@/lib/haptics";
import { type HelpTopic, helpMutation } from "@/lib/help-desk";
import { setTopicSelection, useTopicSelection } from "@/lib/help-topic-selection";
import { useLocale } from "@/lib/i18n";

/**
 * H61/H64: the shared knowledge catalogue in the same searchable sheet as the
 * project challenge picker. Tapping a row toggles it in the draft the form
 * that opened the sheet is holding; a name that is not in the catalogue yet
 * can be added (it becomes a real topic everyone can pick).
 */
export function HelpTopicPickerScreen() {
  const { t } = useLocale();
  const { selected, maximum } = useTopicSelection();
  const [query, setQuery] = useState("");
  const [topics, setTopics] = useState<HelpTopic[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [adding, setAdding] = useState(false);
  const [retry, setRetry] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: retry repeats the catalogue request after an error.
  useEffect(() => {
    let active = true;
    const timer = setTimeout(
      () => {
        void apiFetch<{ topics: HelpTopic[] }>(
          `/api/helpdesk/topics?q=${encodeURIComponent(query.trim())}&limit=50`,
        )
          .then((result) => {
            if (!active) return;
            setTopics(result.topics);
            setError(null);
          })
          .catch((cause) => {
            if (active) setError(cause instanceof Error ? cause : new Error(String(cause)));
          });
      },
      topics === null ? 0 : 250,
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, retry]);
  const name = query.trim().replace(/\s+/g, " ");
  const known = [...selected, ...(topics ?? [])].some(
    (topic) => topic.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
  );
  const full = selected.length >= maximum;
  // Catalogue order; a checkmark changes, the row stays. Selected topics outside the current search stay visible first.
  const rows = [
    ...selected.filter((topic) => !(topics ?? []).some((item) => item.id === topic.id) && !name),
    ...(topics ?? []),
  ];
  function toggle(topic: HelpTopic) {
    void haptic("selection");
    setTopicSelection(
      selected.some((item) => item.id === topic.id)
        ? selected.filter((item) => item.id !== topic.id)
        : [...selected, topic],
    );
  }
  async function add() {
    if (!name || known || adding || full) return;
    setAdding(true);
    try {
      const { topic } = await helpMutation<{ topic: HelpTopic; created: boolean }>(
        "/api/helpdesk/topics",
        { name },
      );
      void haptic("success");
      setError(null);
      if (!selected.some((item) => item.id === topic.id)) setTopicSelection([...selected, topic]);
      setQuery("");
      setRetry((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      setAdding(false);
    }
  }
  return (
    <SearchablePickerSheet
      title={t("helpTopics")}
      searchPlaceholder={t("helpSearchTopics")}
      query={query}
      onQuery={setQuery}
    >
      {error ? (
        <RequestFeedback
          error={error}
          message={error.message}
          onRetry={() => setRetry((v) => v + 1)}
        />
      ) : null}
      {topics === null && !error ? <RequestFeedback loading /> : null}
      {rows.length > 0 || (name && !known) ? (
        <Section>
          {rows.map((topic, index) => {
            const chosen = selected.some((item) => item.id === topic.id);
            return (
              <View key={topic.id}>
                {index > 0 ? <Separator /> : null}
                <CheckRow
                  label={topic.name}
                  selected={chosen}
                  disabled={!chosen && full}
                  onPress={() => toggle(topic)}
                />
              </View>
            );
          })}
          {name && !known ? (
            <>
              {rows.length ? <Separator /> : null}
              <NavRow
                icon="plus.circle"
                chevron={false}
                title={`${t("add")} “${name}”`}
                onPress={() => void add()}
              />
            </>
          ) : null}
        </Section>
      ) : null}
      {topics !== null && rows.length === 0 && !name && !error ? (
        <EmptyState icon="magnifyingglass" title={t("helpNoTopics")} />
      ) : null}
    </SearchablePickerSheet>
  );
}
