import { CAPABILITIES } from "@hackos/shared/capabilities";
import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import { DateTimeField } from "@/components/date-time-field";
import { Section, Separator } from "@/components/native-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { SymbolView } from "@/components/symbol";
import type { CoverageReport } from "@/lib/help-desk";
import { useLocale } from "@/lib/i18n";
import { useMeContext } from "@/lib/me-context";
import { has } from "@/lib/tabs";
import { colors, space, type } from "@/theme";
import { intervalLabel } from "./helper-screen";
import { DetailRow, HelpPage, HelpText, useHelpResource } from "./primitives";

const MAX_RANGE_MS = 500 * 3_600_000;

/** H67: scheduled helpers versus helpers who are also inside the venue, by topic and by hour. */
export function HelpCoverageScreen() {
  const { t, language } = useLocale();
  const { me } = useMeContext();
  const allowed = has(me?.capabilities ?? [], CAPABILITIES.HELPDESK_COVERAGE);
  const [from, setFrom] = useState(() => new Date());
  const [to, setTo] = useState(() => new Date(Date.now() + 86_400_000));
  const rangeValid = to > from && to.getTime() - from.getTime() <= MAX_RANGE_MS;
  // The range applies as soon as it is valid; nothing is fetched for an invalid one.
  const query = useMemo(
    () =>
      rangeValid
        ? `?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}&stepMinutes=60`
        : null,
    [from, to, rangeValid],
  );
  const result = useHelpResource<CoverageReport>(
    allowed && query !== null ? `/api/helpdesk/coverage${query}` : null,
  );
  const report = result.data;
  const dateField = (label: string, value: Date, onChange: (date: Date) => void) => (
    <View
      style={{
        alignItems: "center",
        flexDirection: "row",
        gap: space.md,
        justifyContent: "space-between",
        minHeight: 56,
        paddingHorizontal: space.lg,
        paddingVertical: space.row,
      }}
    >
      <Text style={{ ...type.body, color: colors.label }}>{label}</Text>
      <DateTimeField
        value={value}
        onChange={onChange}
        dateAccessibilityLabel={label}
        timeAccessibilityLabel={label}
      />
    </View>
  );
  return (
    <HelpPage title={t("helpCoverage")} refresh={() => result.load()}>
      {!allowed ? (
        <HelpText>{t("helpNoAccess")}</HelpText>
      ) : (
        <>
          <Section>
            {dateField(t("helpStart"), from, setFrom)}
            <Separator inset={16} />
            {dateField(t("helpEnd"), to, setTo)}
          </Section>
          <RequestFeedback
            loading={result.loading && !report}
            error={result.error}
            onRetry={() => void result.load()}
          />
          {report ? (
            <>
              <Section>
                <DetailRow icon="calendar">
                  <Text style={{ ...type.body, color: colors.label }}>
                    {t("helpScheduledCount", { count: String(report.now.scheduled) })}
                  </Text>
                </DetailRow>
                <Separator inset={16} />
                <DetailRow icon="person.crop.circle.badge.checkmark">
                  <Text style={{ ...type.body, color: colors.label }}>
                    {t("helpPresentCount", { count: String(report.now.available) })}
                  </Text>
                </DetailRow>
              </Section>
              {report.uncoveredTopics.length ? (
                <Section title={t("helpGaps")}>
                  {report.uncoveredTopics.map((topic, index) => (
                    <View key={topic.id}>
                      {index > 0 ? <Separator inset={16} /> : null}
                      <View
                        style={{
                          alignItems: "center",
                          flexDirection: "row",
                          gap: space.md,
                          minHeight: 50,
                          paddingHorizontal: space.lg,
                        }}
                      >
                        <SymbolView
                          name="exclamationmark.triangle.fill"
                          tintColor={colors.warning}
                          size={20}
                          accessible={false}
                        />
                        <Text style={{ ...type.body, color: colors.label }}>{topic.name}</Text>
                      </View>
                    </View>
                  ))}
                </Section>
              ) : null}
              {report.now.topics.length ? (
                <Section title={t("helpCoverageTopics")}>
                  {report.now.topics.map((topic, index) => (
                    <View key={topic.id}>
                      {index > 0 ? <Separator inset={16} /> : null}
                      <View style={{ gap: 2, minHeight: 56, padding: space.lg }}>
                        <Text style={{ ...type.body, color: colors.label }}>{topic.name}</Text>
                        <Text style={{ ...type.compact, color: colors.secondaryLabel }}>
                          {t("helpScheduledCount", { count: String(topic.scheduled) })} ·{" "}
                          {t("helpPresentCount", { count: String(topic.available) })}
                        </Text>
                      </View>
                    </View>
                  ))}
                </Section>
              ) : null}
              <Section title={t("helpSchedule")}>
                {report.slots.map((slot, index) => (
                  <View key={slot.startsAt}>
                    {index > 0 ? <Separator inset={16} /> : null}
                    <View style={{ gap: 2, minHeight: 56, padding: space.lg }}>
                      <Text style={{ ...type.body, color: colors.label }}>
                        {intervalLabel(slot, language)}
                      </Text>
                      <Text style={{ ...type.compact, color: colors.secondaryLabel }}>
                        {[
                          t("helpScheduledCount", { count: String(slot.scheduled) }),
                          ...slot.topics.map((topic) => `${topic.name} (${topic.scheduled})`),
                        ].join(" · ")}
                      </Text>
                    </View>
                  </View>
                ))}
              </Section>
            </>
          ) : null}
        </>
      )}
    </HelpPage>
  );
}
