import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { EmptyState, Section, Separator } from "@/components/native-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { canBrowseHelpDesk, type HelperCard } from "@/lib/help-desk";
import { useLocale } from "@/lib/i18n";
import { useMeContext } from "@/lib/me-context";
import { HelpPage, HelpText, useHelpResource } from "./primitives";
import { HelperRow } from "./rows";

/** H63: published helpers, searchable by name or knowledge, available ones first (server order). */
export function HelpersScreen() {
  const { t } = useLocale();
  const router = useRouter();
  const { me } = useMeContext();
  const allowed = canBrowseHelpDesk(me?.capabilities ?? []);
  const result = useHelpResource<{ helpers: HelperCard[] }>(
    allowed ? "/api/helpdesk/helpers" : null,
  );
  const [query, setQuery] = useState("");
  const needle = query.trim().toLocaleLowerCase();
  const helpers = result.data?.helpers.filter((helper) =>
    [helper.displayName, ...helper.topics.map((topic) => topic.name)].some((value) =>
      value.toLocaleLowerCase().includes(needle),
    ),
  );
  return (
    <HelpPage
      title={t("helpHelpers")}
      refresh={() => result.load()}
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
          {helpers?.length === 0 ? <EmptyState icon="person.2" title={t("helpNoHelpers")} /> : null}
          {helpers?.length ? (
            <Section>
              {helpers.map((helper, index) => (
                <View key={helper.userId}>
                  {index > 0 ? <Separator inset={76} /> : null}
                  <HelperRow
                    helper={helper}
                    onPress={() =>
                      router.push({
                        pathname: "/(tabs)/help-desk/helper/[id]",
                        params: { id: helper.userId },
                      })
                    }
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
