import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { EmptyState, Section, Separator } from "@/components/native-ui";
import { NavRow } from "@/components/project-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { CheckRow, SearchablePickerSheet } from "@/components/searchable-picker";
import { apiFetch } from "@/lib/api";
import { haptic } from "@/lib/haptics";
import { type HelpTopic, helpMutation } from "@/lib/help-desk";
import {
  setOtherSelection,
  setTopicSelection,
  useTopicSelection,
} from "@/lib/help-topic-selection";
import { useLocale } from "@/lib/i18n";

/**
 * H61/H64: the shared knowledge catalogue in the same searchable sheet as the
 * project challenge picker. Tapping a row toggles it in the draft the form
 * that opened the sheet is holding; a name that is not in the catalogue yet
 * can be added (it becomes a real topic everyone can pick). On the request
 * form, "Other" is its own group above the catalogue (like None in the
 * challenge picker) and excludes the catalogue topics.
 */
export function HelpTopicPickerScreen() {
  const { t } = useLocale();
  const { selected, maximum, other, allowOther, allowAdd } = useTopicSelection();
  // What the form held when the sheet opened: Close restores it.
  const opening = useRef({ selected, other });
  const [query, setQuery] = useState("");
  const [topics, setTopics] = useState<HelpTopic[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [addError, setAddError] = useState<Error | null>(null);
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
            if (!active) return;
            // Rows of an earlier search must not pass for this one's answer.
            setTopics(null);
            setError(cause instanceof Error ? cause : new Error(String(cause)));
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
    if (!allowAdd || !name || known || adding || full) return;
    setAdding(true);
    setAddError(null);
    try {
      const { topic } = await helpMutation<{ topic: HelpTopic; created: boolean }>(
        "/api/helpdesk/topics",
        { name },
      );
      void haptic("success");
      if (!selected.some((item) => item.id === topic.id)) setTopicSelection([...selected, topic]);
      setQuery("");
      setRetry((value) => value + 1);
    } catch (cause) {
      setAddError(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      setAdding(false);
    }
  }
  return (
    <SearchablePickerSheet
      title={t("helpTopics")}
      searchPlaceholder={t(allowAdd ? "helpSearchAddTopics" : "helpSearchTopics")}
      query={query}
      onQuery={(next) => {
        setAddError(null);
        setQuery(next);
      }}
      onDiscard={() => {
        setTopicSelection(opening.current.selected);
        setOtherSelection(opening.current.other);
      }}
    >
      {error ? (
        <RequestFeedback
          error={error}
          message={error.message}
          onRetry={() => setRetry((v) => v + 1)}
        />
      ) : null}
      {addError ? (
        <RequestFeedback error={addError} message={addError.message} onRetry={() => void add()} />
      ) : null}
      {topics === null && !error ? <RequestFeedback loading /> : null}
      {allowOther && !name ? (
        <Section>
          <CheckRow
            label={t("helpOther")}
            selected={other}
            onPress={() => {
              void haptic("selection");
              setOtherSelection(!other);
            }}
          />
        </Section>
      ) : null}
      {rows.length > 0 || (allowAdd && name && !known) ? (
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
          {allowAdd && name && !known ? (
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
      {topics !== null && rows.length === 0 && (!name || !allowAdd) && !error ? (
        <EmptyState icon="magnifyingglass" title={t("helpNoTopics")} />
      ) : null}
    </SearchablePickerSheet>
  );
}
