"use client";

// Meals and registrable activities consumed by this person (H25-H26).

import { isMealActivityKind } from "@hackos/shared/activity-kinds";
import { domainScope, EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import { type Column, DataTable } from "@/components/common/data-table";
import { EmptyState } from "@/components/common/empty-state";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
import { useLiveQuery } from "@/hooks/use-live-query";
import { api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import type { ActivityPass, UserActivity } from "./logs-tab";
import { formatUserDate } from "./shared";

export function PhysicalActivity({
  userId,
  embedded = false,
}: {
  userId: number;
  embedded?: boolean;
}) {
  const { language, t } = useLocale();
  const { data, error, loading } = useLiveQuery(
    (signal) => api.get<UserActivity>(`/api/users/${userId}/activity`, { signal }),
    domainScope(SSE_TOPICS.IDENTITY),
    [EVENTS.DOMAIN_CHANGED],
    { resourceKey: ["users", "activity", userId] },
  );

  if (loading && !error) {
    return (
      <div className="flex justify-center py-12">
        <Spinner className="size-5" />
      </div>
    );
  }
  if (!data) {
    return (
      <EmptyState title={t("couldNotLoadActivityTitle")} description={t("passesUnavailable")} />
    );
  }

  const passColumns: Column<ActivityPass>[] = [
    {
      id: "activity",
      header: t("columnActivity"),
      cell: (p) => <span className="text-sm">{p.activityName}</span>,
    },
    {
      id: "type",
      header: t("colType"),
      cell: (p) => (
        <span className="text-muted-foreground text-sm">
          {isMealActivityKind(p.category) ? t("typeMeal") : t("typeWorkshop")}
        </span>
      ),
    },
    {
      id: "when",
      header: t("colWhen"),
      sortValue: (p) => p.loggedAt,
      cell: (p) => <span className="text-sm">{formatUserDate(p.loggedAt, language)}</span>,
    },
  ];

  const table = (
    <DataTable
      columns={passColumns}
      data={data.passes}
      getRowId={(p) => String(p.id)}
      pageSize={10}
      empty={{
        title: t("noPassesYet"),
        description: t("passesWillAppear"),
      }}
    />
  );

  if (embedded) return table;

  return (
    <SectionCard title={t("activityPasses")} bodyClassName="p-0">
      {table}
    </SectionCard>
  );
}
