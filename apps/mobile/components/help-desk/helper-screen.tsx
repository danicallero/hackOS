import { useLocalSearchParams } from "expo-router";
import { Text, View } from "react-native";
import { InfoRow, Section, Separator, StatusPill } from "@/components/native-ui";
import { PersonAvatar } from "@/components/person-avatar";
import { RequestFeedback } from "@/components/RequestFeedback";
import { formatEventTime } from "@/lib/event-time";
import type { AvailabilityInterval, HelperCard } from "@/lib/help-desk";
import { useLocale } from "@/lib/i18n";
import { colors, space, type } from "@/theme";
import { HelpNote, HelpPage, TopicChips, useHelpResource } from "./primitives";

export function intervalLabel(interval: AvailabilityInterval, language: string) {
  const options = { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" } as const;
  return `${formatEventTime(interval.startsAt, language, options)} – ${formatEventTime(interval.endsAt, language, options)}`;
}

/** H63: a helper's identity (shared public profile), knowledge and dated schedule, apart from presence. */
export function HelperScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, language } = useLocale();
  const result = useHelpResource<HelperCard>(`/api/helpdesk/helpers/${encodeURIComponent(id)}`);
  const helper = result.data;
  const day = { weekday: "short", day: "numeric", month: "short" } as const;
  const clock = { hour: "2-digit", minute: "2-digit" } as const;
  return (
    <HelpPage title={helper?.displayName ?? t("helpHelper")} refresh={() => result.load()}>
      <RequestFeedback
        loading={result.loading && !helper}
        error={result.error}
        onRetry={() => void result.load()}
      />
      {helper ? (
        <>
          <View style={{ alignItems: "center", gap: space.sm }}>
            <PersonAvatar size={96} name={helper.displayName} uri={helper.photoUrl} />
            {helper.headline ? (
              <Text style={{ ...type.body, color: colors.label, textAlign: "center" }}>
                {helper.headline}
              </Text>
            ) : null}
            {helper.affiliation ? (
              <Text style={{ ...type.subhead, color: colors.secondaryLabel }}>
                {helper.affiliation}
              </Text>
            ) : null}
            <View
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                gap: space.xs,
                justifyContent: "center",
              }}
            >
              <StatusPill tone={helper.scheduledNow ? "success" : "neutral"}>
                {t(helper.scheduledNow ? "helpScheduledNow" : "helpNotScheduledNow")}
              </StatusPill>
              <StatusPill tone={helper.present ? "success" : "neutral"}>
                {t(helper.present ? "helpInside" : "helpOutside")}
              </StatusPill>
            </View>
          </View>
          {helper.bio ? (
            <Section>
              <Text selectable style={{ ...type.body, color: colors.label, padding: space.lg }}>
                {helper.bio}
              </Text>
            </Section>
          ) : null}
          {helper.topics.length ? (
            <Section title={t("helpTopics")}>
              <View style={{ padding: space.lg }}>
                <TopicChips topics={helper.topics} />
              </View>
            </Section>
          ) : null}
          <Section title={t("helpSchedule")} footer={t("helpScheduleNote")}>
            {helper.availability.length ? (
              helper.availability.map((interval, index) => (
                <View key={interval.startsAt}>
                  {index > 0 ? <Separator inset={16} /> : null}
                  <InfoRow
                    label={formatEventTime(interval.startsAt, language, day)}
                    value={`${formatEventTime(interval.startsAt, language, clock)}–${formatEventTime(interval.endsAt, language, clock)}`}
                  />
                </View>
              ))
            ) : (
              <HelpNote>{t("helpNoSchedule")}</HelpNote>
            )}
          </Section>
        </>
      ) : null}
    </HelpPage>
  );
}
