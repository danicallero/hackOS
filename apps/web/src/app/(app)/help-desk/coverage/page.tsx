"use client";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { useState } from "react";
import { AccessDenied } from "@/components/common/access-denied";
import { type Column, DataTable } from "@/components/common/data-table";
import { PageLayout } from "@/components/common/page-layout";
import { SectionCard } from "@/components/common/section-card";
import { HelpDeskSectionHeader } from "@/components/common/section-navigation";
import { StaleDataNotice } from "@/components/common/stale-data-notice";
import { StatusBadge } from "@/components/common/status-badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDurationMinutes, formatEventClock } from "@/lib/datetime";
import { useEventTimeZone, useEventZoneHint } from "@/lib/event-time";
import { useLocale } from "@/lib/i18n";
import { useCan } from "@/lib/session";
import type { CoverageReport } from "../model";
import { useDayLabel } from "../schedule-view";
import { HelpdeskError, HelpdeskLoading, useHelpdesk } from "../shared";
import { coverageDays, type PlacedSlot, type TopicCoverage, topicCoverage } from "./coverage-model";
import { CoverageTimeline } from "./coverage-timeline";

const STEPS = [30, 60, 120] as const;
const KINDS = [
  ["mentor", "helpDeskKindMentors"],
  ["sponsor", "helpDeskKindSponsors"],
  ["staff", "helpDeskKindStaff"],
] as const;

/**
 * H67: organizers read coverage in three parts: right now (scheduled versus
 * actually inside the venue, H24), the timeline of scheduled helpers across
 * the event days, and knowledge with its gaps.
 */
export default function CoveragePage() {
  const { t } = useLocale();
  const allowed = useCan(CAPABILITIES.HELPDESK_COVERAGE);
  const [step, setStep] = useState<number>(60);
  const resource = useHelpdesk<CoverageReport>(
    ["coverage", step],
    `/api/helpdesk/coverage?stepMinutes=${step}`,
    allowed,
  );
  if (!allowed) return <AccessDenied ask={t("noAccessTitle")} />;
  const report = resource.data;
  return (
    <PageLayout>
      <HelpDeskSectionHeader
        meta={
          report ? (
            <span className="text-muted-foreground text-sm tabular-nums">
              {[
                t("helpDeskPublishedCount", { count: report.totals.publishedHelpers }),
                ...KINDS.map(([kind, label]) => `${t(label)} ${report.totals.byKind[kind]}`),
              ].join(" · ")}
            </span>
          ) : undefined
        }
      />
      {resource.stale ? <StaleDataNotice onRetry={resource.refetch} /> : null}
      {resource.error ? <HelpdeskError error={resource.error} retry={resource.refetch} /> : null}
      {resource.loading && !report ? <HelpdeskLoading /> : null}
      {report ? (
        <>
          <NowSection report={report} />
          <TimelineSection report={report} step={step} onStepChange={setStep} />
          <TopicsSection report={report} />
        </>
      ) : null}
    </PageLayout>
  );
}

export function NowSection({ report }: { report: CoverageReport }) {
  const { t, language } = useLocale();
  const { scheduled, present } = report.now;
  return (
    <SectionCard
      variant="plain"
      title={t("helpDeskNowTitle")}
      state={
        <time dateTime={report.now.at} className="text-muted-foreground text-sm tabular-nums">
          {formatEventClock(report.now.at, language)}
        </time>
      }
    >
      <dl className="grid items-start gap-x-8 gap-y-5 sm:grid-cols-2">
        <div className="space-y-1">
          <dt className="text-sm font-medium">{t("helpDeskScheduledCount")}</dt>
          <dd className="text-2xl tabular-nums">{scheduled}</dd>
        </div>
        <div className="space-y-1">
          <dt className="text-sm font-medium">{t("helpDeskPresent")}</dt>
          <dd className="text-2xl tabular-nums">{present}</dd>
        </div>
      </dl>
    </SectionCard>
  );
}

function TimelineSection({
  report,
  step,
  onStepChange,
}: {
  report: CoverageReport;
  step: number;
  onStepChange: (step: number) => void;
}) {
  const { t, language } = useLocale();
  const zone = useEventTimeZone();
  const zoneHint = useEventZoneHint(language);
  const dayLabel = useDayLabel();
  const days = coverageDays(report, zone);
  const slots = days.flatMap((day) => day.slots.map((slot) => ({ ...slot, day: day.day })));
  const nowMs = Date.parse(report.now.at);
  const fallback =
    slots.find((slot) => Date.parse(slot.startsAt) <= nowMs && nowMs < Date.parse(slot.endsAt)) ??
    slots.reduce<(typeof slots)[number] | null>(
      (best, slot) => (!best || slot.scheduled > best.scheduled ? slot : best),
      null,
    );
  const [selectedAt, setSelectedAt] = useState<string | null>(null);
  const selected = slots.find((slot) => slot.startsAt === selectedAt) ?? fallback;
  return (
    <SectionCard
      variant="plain"
      title={t("helpDeskTimelineTitle")}
      action={
        <Select value={String(step)} onValueChange={(value) => onStepChange(Number(value))}>
          <SelectTrigger size="sm" aria-label={t("helpDeskSlotSize")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {STEPS.map((minutes) => (
              <SelectItem key={minutes} value={String(minutes)}>
                {formatDurationMinutes(minutes, t)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    >
      {days.length ? (
        <div className="grid min-w-0 items-start gap-x-8 gap-y-6 lg:grid-cols-[minmax(0,1fr)_16rem]">
          <CoverageTimeline
            days={days}
            stepMinutes={report.stepMinutes}
            nowAt={report.now.at}
            selected={selected?.startsAt ?? null}
            onSelect={(slot: PlacedSlot) => setSelectedAt(slot.startsAt)}
          />
          {selected ? (
            <div aria-live="polite" className="min-w-0 space-y-3 lg:border-l lg:pl-6">
              <div>
                <p className="text-sm font-medium">{dayLabel(selected.day)}</p>
                <p className="text-muted-foreground text-sm tabular-nums">
                  {[
                    `${formatEventClock(selected.startsAt, language)}–${formatEventClock(
                      selected.endsAt,
                      language,
                    )}`,
                    zoneHint,
                  ]
                    .filter(Boolean)
                    .join(" ")}
                </p>
              </div>
              <p className="text-3xl font-semibold tabular-nums">
                {selected.scheduled}
                <span className="text-muted-foreground ml-2 text-sm font-normal">
                  {t("helpDeskScheduledCount")}
                </span>
              </p>
              {selected.scheduled > 0 ? (
                <>
                  <p className="text-sm tabular-nums">
                    {KINDS.map(([kind, label]) => `${t(label)} ${selected.byKind[kind]}`).join(
                      " · ",
                    )}
                  </p>
                  <ul className="divide-y divide-border/60 text-sm">
                    {selected.topics.map((topic) => (
                      <li key={topic.id} className="flex justify-between gap-3 py-1.5">
                        <span className="min-w-0 wrap-anywhere">{topic.name}</span>
                        <span className="tabular-nums">{topic.scheduled}</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <StatusBadge tone="warning">{t("helpDeskNoHelpersScheduled")}</StatusBadge>
              )}
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">{t("helpDeskNoCoverage")}</p>
      )}
    </SectionCard>
  );
}

function TopicsSection({ report }: { report: CoverageReport }) {
  const { t } = useLocale();
  const topics = topicCoverage(report);
  const gap = (topic: TopicCoverage) =>
    topic.uncovered ? (
      <StatusBadge tone="warning">{t("helpDeskTopicUncovered")}</StatusBadge>
    ) : topic.coveredMinutes === 0 ? (
      <StatusBadge tone="warning">{t("helpDeskNoHelpersScheduled")}</StatusBadge>
    ) : topic.scheduledNow > 0 && topic.availableNow === 0 ? (
      <StatusBadge tone="neutral">{t("helpDeskTopicNobodyInside")}</StatusBadge>
    ) : null;
  const columns: Column<TopicCoverage>[] = [
    {
      id: "topic",
      header: t("helpDeskKnowledge"),
      cell: (topic) => <span className="font-medium">{topic.name}</span>,
      sortValue: (topic) => topic.name,
    },
    {
      id: "covered",
      header: t("helpDeskCoveredTime"),
      align: "right",
      cell: (topic) => (
        <span className="tabular-nums">{formatDurationMinutes(topic.coveredMinutes, t)}</span>
      ),
      sortValue: (topic) => topic.coveredMinutes,
    },
    {
      id: "peak",
      header: t("helpDeskPeak"),
      align: "right",
      cell: (topic) => <span className="tabular-nums">{topic.peak}</span>,
      sortValue: (topic) => topic.peak,
    },
    {
      id: "now",
      header: t("helpDeskNowColumn"),
      cell: (topic) => (
        <span className="tabular-nums">
          {t("helpDeskTopicCoverage", {
            scheduled: topic.scheduledNow,
            available: topic.availableNow,
          })}
        </span>
      ),
      sortValue: (topic) => topic.availableNow,
    },
    { id: "gap", header: t("helpDeskGapColumn"), cell: (topic) => gap(topic) },
  ];
  return (
    <SectionCard variant="plain" title={t("helpDeskKnowledge")}>
      <DataTable
        data={topics}
        columns={columns}
        getRowId={(topic) => String(topic.id)}
        empty={{ title: t("helpDeskNoCoverage") }}
        renderMobileRow={(topic) => (
          <div className="space-y-1 px-4 py-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <span className="font-medium wrap-anywhere">{topic.name}</span>
              {gap(topic)}
            </div>
            <p className="text-muted-foreground text-xs tabular-nums">
              {[
                `${t("helpDeskCoveredTime")} ${formatDurationMinutes(topic.coveredMinutes, t)}`,
                `${t("helpDeskPeak")} ${topic.peak}`,
                t("helpDeskTopicCoverage", {
                  scheduled: topic.scheduledNow,
                  available: topic.availableNow,
                }),
              ].join(" · ")}
            </p>
          </div>
        )}
      />
    </SectionCard>
  );
}
