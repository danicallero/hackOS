import { CAPABILITIES } from "@hackos/shared/capabilities";
import { View } from "react-native";
import { EmptyState, InfoRow, Section, Separator } from "@/components/native-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { eventDayKey } from "@/lib/event-time";
import { type CoverageReport, clockRange, coverageDays, dayLabel } from "@/lib/help-desk";
import { useLocale } from "@/lib/i18n";
import { useMeContext } from "@/lib/me-context";
import { has } from "@/lib/tabs";
import { useHelpResource } from "@/lib/use-help-resource";
import { colors, space } from "@/theme";
import { CoverageDayStrip } from "./coverage-chart";
import { HelpPage, HelpText } from "./primitives";

/**
 * H67: coverage across the event, read like a Calendar day list. "Now" keeps
 * scheduled helpers apart from those also inside the venue (H24); each day
 * then lists ranges of equal coverage, so a gap with nobody scheduled is one
 * highlighted row rather than a run of hourly zeros.
 */
export function HelpCoverageScreen() {
  const { t, language } = useLocale();
  const { me } = useMeContext();
  const allowed = has(me?.capabilities ?? [], CAPABILITIES.HELPDESK_COVERAGE);
  const result = useHelpResource<CoverageReport>(
    allowed ? "/api/helpdesk/coverage?stepMinutes=60" : null,
  );
  const report = result.data;
  const peak = report ? Math.max(0, ...report.slots.map((slot) => slot.scheduled)) : 0;
  const days = report ? coverageDays(report.slots, (iso) => eventDayKey(iso)) : [];
  return (
    <HelpPage title={t("helpCoverage")} fixedTitle refresh={() => result.load()}>
      {allowed ? null : <HelpText>{t("helpNoAccess")}</HelpText>}
      <RequestFeedback
        loading={result.loading && !report}
        error={result.error}
        onRetry={() => void result.load()}
      />
      {report ? (
        <>
          <Section title={t("helpNow")}>
            <InfoRow
              icon="calendar"
              label={t("helpScheduledNowLabel")}
              value={String(report.now.scheduled)}
            />
            <Separator inset={48} />
            <InfoRow
              icon="person.crop.circle.badge.checkmark"
              label={t("helpInsideNowLabel")}
              value={String(report.now.available)}
            />
          </Section>
          {report.uncoveredTopics.length ? (
            <Section title={t("helpGaps")}>
              {report.uncoveredTopics.map((topic, index) => (
                <View key={topic.id}>
                  {index > 0 ? <Separator inset={48} /> : null}
                  <InfoRow
                    icon="exclamationmark.triangle"
                    label={topic.name}
                    value={t("helpNobodyAvailable")}
                    valueStyle={{ color: colors.warning }}
                  />
                </View>
              ))}
            </Section>
          ) : null}
          {report.now.topics.length ? (
            <Section title={t("helpCoverageTopics")}>
              {report.now.topics.map((topic, index) => (
                <View key={topic.id}>
                  {index > 0 ? <Separator inset={16} /> : null}
                  <InfoRow
                    label={topic.name}
                    value={`${t("helpScheduledCount", { count: String(topic.scheduled) })} · ${t("helpInsideCount", { count: String(topic.available) })}`}
                  />
                </View>
              ))}
            </Section>
          ) : null}
          {days.length === 0 ? (
            <EmptyState icon="calendar.badge.clock" title={t("mobileStatesCoverageEmpty")} />
          ) : null}
          {days.map((day) => (
            <Section key={day.key} title={dayLabel(day.runs[0].startsAt, language)}>
              <View style={{ padding: space.lg }}>
                <CoverageDayStrip slots={report.slots} dayKey={day.key} max={peak} />
              </View>
              <Separator />
              {day.runs.map((run, index) => (
                <View key={run.startsAt}>
                  {index > 0 ? <Separator inset={16} /> : null}
                  <InfoRow
                    label={clockRange(run, language)}
                    value={
                      run.scheduled === 0
                        ? t("helpNobody")
                        : [
                            run.scheduled === 1
                              ? t("helpHelperCountOne")
                              : t("helpHelperCount", { count: String(run.scheduled) }),
                            ...run.topics.map((topic) => topic.name),
                          ].join(" · ")
                    }
                    valueStyle={run.scheduled === 0 ? { color: colors.warning } : undefined}
                  />
                </View>
              ))}
            </Section>
          ))}
        </>
      ) : null}
    </HelpPage>
  );
}
