"use client";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { BookOpenIcon } from "@phosphor-icons/react/dist/csr/BookOpen";
import { ClockIcon } from "@phosphor-icons/react/dist/csr/Clock";
import { UsersThreeIcon } from "@phosphor-icons/react/dist/csr/UsersThree";
import Link from "next/link";
import { useState } from "react";
import { AccessDenied } from "@/components/common/access-denied";
import { type Column, DataTable } from "@/components/common/data-table";
import type { FilterDefinition } from "@/components/common/filter-menu";
import { ListToolbar } from "@/components/common/list-toolbar";
import { PageLayout } from "@/components/common/page-layout";
import { HelpDeskSectionHeader } from "@/components/common/section-navigation";
import { StaleDataNotice } from "@/components/common/stale-data-notice";
import { UserAvatar } from "@/components/common/user-avatar";
import { useEventTimeZone } from "@/lib/event-time";
import { type MessageKey, useLocale } from "@/lib/i18n";
import { useSessionContext } from "@/lib/session";
import type { HelperCard } from "./model";
import { scheduleDays } from "./schedule";
import { useDayLabel, useIntervalLabel } from "./schedule-view";
import { HelperPresence, useHelpdesk } from "./shared";

const NOW_FILTERS = {
  all: "helpDeskFilterAll",
  available: "helpDeskPresentCount",
  scheduled: "helpDeskScheduledNow",
  present: "helpDeskPresent",
} as const satisfies Record<string, MessageKey>;

/** H63: published helpers, found by name or knowledge, without scanning a badge. */
export default function HelpdeskPage() {
  const { t } = useLocale();
  const { canAny } = useSessionContext();
  const zone = useEventTimeZone();
  const dayLabel = useDayLabel();
  const intervalLabel = useIntervalLabel();
  const allowed = canAny(
    CAPABILITIES.HELPDESK_REQUEST,
    CAPABILITIES.HELPDESK_OFFER,
    CAPABILITIES.HELPDESK_COVERAGE,
  );
  const [query, setQuery] = useState("");
  const [topics, setTopics] = useState<string[]>([]);
  const [now, setNow] = useState<string>("all");
  const helpers = useHelpdesk<{ helpers: HelperCard[] }>(
    ["helpers", query],
    `/api/helpdesk/helpers?q=${encodeURIComponent(query)}`,
    allowed,
  );
  if (!allowed) return <AccessDenied ask={t("noAccessTitle")} />;
  const all = helpers.data?.helpers ?? [];
  const topicOptions = [
    ...new Map(all.flatMap((helper) => helper.topics).map((topic) => [topic.id, topic])).values(),
  ].sort((a, b) => a.name.localeCompare(b.name));
  const rows = all.filter(
    (helper) =>
      (topics.length === 0 || helper.topics.some((topic) => topics.includes(String(topic.id)))) &&
      (now === "all" ||
        (now === "available" && helper.availableNow) ||
        (now === "scheduled" && helper.scheduledNow) ||
        (now === "present" && helper.present)),
  );
  const filters: FilterDefinition[] = [
    {
      id: "topics",
      label: t("helpDeskKnowledge"),
      icon: BookOpenIcon,
      type: "multiple",
      value: topics,
      onChange: setTopics,
      options: topicOptions.map((topic) => ({ value: String(topic.id), label: topic.name })),
    },
    {
      id: "now",
      label: t("helpDeskNowColumn"),
      icon: ClockIcon,
      type: "single",
      value: now,
      resetValue: "all",
      onChange: setNow,
      options: Object.entries(NOW_FILTERS).map(([value, label]) => ({ value, label: t(label) })),
    },
  ];
  /** The next interval that has not ended, as "Sat, 27 Feb · 10:00–13:00". */
  const nextAvailability = (helper: HelperCard) => {
    const nowMs = Date.now();
    for (const day of scheduleDays(helper.availability, zone)) {
      const interval = day.intervals.find((item) => Date.parse(item.endsAt) > nowMs);
      if (interval) return `${dayLabel(day.day)} · ${intervalLabel(interval)}`;
    }
    return t("helpDeskNoSchedule");
  };
  const identity = (helper: HelperCard) => (
    <div className="flex min-w-0 items-center gap-3">
      <UserAvatar
        name={helper.displayName}
        image={helper.photoUrl}
        decorative
        className="size-8 shrink-0"
      />
      <div className="min-w-0">
        <p className="font-medium wrap-anywhere">{helper.displayName}</p>
        {helper.affiliation || helper.headline ? (
          <p className="text-muted-foreground line-clamp-1 text-xs">
            {[helper.affiliation, helper.headline].filter(Boolean).join(" · ")}
          </p>
        ) : null}
      </div>
    </div>
  );
  const columns: Column<HelperCard>[] = [
    {
      id: "helper",
      header: t("helpDeskHelperColumn"),
      cell: identity,
      sortValue: (helper) => helper.displayName,
    },
    {
      id: "knowledge",
      header: t("helpDeskKnowledge"),
      cell: (helper) => (
        <span className="line-clamp-2 max-w-xs whitespace-normal">
          {helper.topics.map((topic) => topic.name).join(" · ")}
        </span>
      ),
    },
    {
      id: "next",
      header: t("helpDeskNextAvailability"),
      cell: (helper) => <span className="tabular-nums">{nextAvailability(helper)}</span>,
    },
    {
      id: "now",
      header: t("helpDeskNowColumn"),
      cell: (helper) => <HelperPresence helper={helper} />,
      sortValue: (helper) => Number(helper.availableNow) * 2 + Number(helper.scheduledNow),
    },
  ];
  const filtered = topics.length > 0 || now !== "all";
  return (
    <PageLayout>
      <HelpDeskSectionHeader />
      <div className="space-y-4">
        <ListToolbar
          search={{
            value: query,
            onValueChange: setQuery,
            placeholder: t("helpDeskSearch"),
            label: t("helpDeskSearch"),
          }}
          filters={filters}
        />
        {helpers.stale ? <StaleDataNotice onRetry={helpers.refetch} /> : null}
        <DataTable
          data={rows}
          columns={columns}
          getRowId={(helper) => String(helper.userId)}
          getRowHref={(helper) => `/help-desk/helpers/${helper.userId}`}
          getRowLabel={(helper) => helper.displayName}
          loading={helpers.loading}
          error={
            helpers.error
              ? { message: t("helpDeskLoadError"), onRetry: helpers.refetch }
              : undefined
          }
          empty={{
            icon: UsersThreeIcon,
            title: t(query ? "helpDeskNoMatches" : "helpDeskNoHelpers"),
          }}
          filteredEmpty={{
            active: filtered,
            onClear: () => {
              setTopics([]);
              setNow("all");
            },
          }}
          renderMobileRow={(helper) => (
            <Link
              href={`/help-desk/helpers/${helper.userId}`}
              className="focus-visible:ring-ring block space-y-2 px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-inset"
            >
              {identity(helper)}
              <p className="text-sm">{helper.topics.map((topic) => topic.name).join(" · ")}</p>
              <p className="text-muted-foreground text-xs tabular-nums">
                {nextAvailability(helper)}
              </p>
              <HelperPresence helper={helper} />
            </Link>
          )}
        />
      </div>
    </PageLayout>
  );
}
