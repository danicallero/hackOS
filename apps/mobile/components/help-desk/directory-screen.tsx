import { useState } from "react";
import { View } from "react-native";
import { FilterMenu } from "@/components/filter-menu";
import { EmptyState, Section, Separator } from "@/components/native-ui";
import { NoResultsState } from "@/components/no-results-state";
import { RequestFeedback } from "@/components/RequestFeedback";
import { canBrowseHelpDesk, filterHelpers, type HelperCard } from "@/lib/help-desk";
import { useLocale } from "@/lib/i18n";
import { useMeContext } from "@/lib/me-context";
import { useHelpResource } from "@/lib/use-help-resource";
import { HelpPage, HelpText } from "./primitives";
import { HelperRow } from "./rows";

/** H63: published helpers, searchable by name or knowledge, available ones first (server order). */
export function HelpersScreen() {
  const { t } = useLocale();
  const { me } = useMeContext();
  const allowed = canBrowseHelpDesk(me?.capabilities ?? []);
  const result = useHelpResource<{ helpers: HelperCard[] }>(
    allowed ? "/api/helpdesk/helpers" : null,
  );
  const [query, setQuery] = useState("");
  const [roles, setRoles] = useState<string[]>([]);
  const [topicIds, setTopicIds] = useState<number[]>([]);
  const all = result.data?.helpers ?? [];
  const helpers = result.data
    ? filterHelpers(all, { query, kinds: [], roles, topicIds })
    : undefined;
  // Roles and knowledge present in the list; the menu stays open while they are toggled.
  const roleOptions = [
    ...new Set(
      all.map((helper) => helper.visibleRoleName).filter((role): role is string => !!role),
    ),
  ].sort((a, b) => a.localeCompare(b));
  const topicOptions = [
    ...new Map(all.flatMap((helper) => helper.topics).map((topic) => [topic.id, topic])).values(),
  ].sort((a, b) => a.name.localeCompare(b.name));
  const active = roles.length > 0 || topicIds.length > 0;
  const toggle = <T,>(list: T[], value: T) =>
    list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
  const filter = (
    <FilterMenu
      accessibilityLabel={t("scheduleFilter")}
      active={active}
      items={[
        ...roleOptions.map((role) => ({
          id: `role:${role}`,
          label: role,
          selected: roles.includes(role),
          section: t("helpFilterRole"),
        })),
        ...topicOptions.map((topic) => ({
          id: `topic:${topic.id}`,
          label: topic.name,
          selected: topicIds.includes(topic.id),
          section: t("helpFilterKnowledge"),
        })),
        ...(active ? [{ id: "clear", label: t("scheduleFilterClear"), selected: false }] : []),
      ]}
      onSelect={(id) => {
        if (id === "clear") {
          setRoles([]);
          setTopicIds([]);
        } else if (id.startsWith("role:")) {
          setRoles((list) => toggle(list, id.slice(5)));
        } else if (id.startsWith("topic:")) {
          setTopicIds((list) => toggle(list, Number(id.slice(6))));
        }
      }}
    />
  );
  return (
    <HelpPage
      title={t("helpHelpers")}
      fixedTitle
      refresh={() => result.load()}
      filter={allowed && all.length > 0 ? filter : undefined}
      search={allowed ? { placeholder: t("helpSearchHelpers"), onChange: setQuery } : undefined}
    >
      {!allowed ? (
        <HelpText>{t("helpNoAccess")}</HelpText>
      ) : (
        <>
          <RequestFeedback
            loading={result.loading && !result.data}
            error={result.error}
            onRetry={() => void result.load()}
          />
          {helpers?.length === 0 ? (
            all.length > 0 ? (
              <NoResultsState
                onClear={
                  active
                    ? () => {
                        setRoles([]);
                        setTopicIds([]);
                      }
                    : undefined
                }
              />
            ) : (
              <EmptyState icon="person.2" title={t("helpNoHelpers")} />
            )
          ) : null}
          {helpers?.length ? (
            <Section>
              {helpers.map((helper, index) => (
                <View key={helper.userId}>
                  {index > 0 ? <Separator inset={76} /> : null}
                  <HelperRow
                    helper={helper}
                    href={{
                      pathname: "/(tabs)/help-desk/helper/[id]",
                      params: { id: helper.userId },
                    }}
                  />
                </View>
              ))}
            </Section>
          ) : null}
        </>
      )}
    </HelpPage>
  );
}
