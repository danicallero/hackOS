"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS } from "@hackos/shared/events";
import { ActivityIcon, BadgeCheckIcon, LockIcon, SoupIcon, UsersIcon } from "lucide-react";
import { type Column, DataTable } from "@/components/common/data-table";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { StatCard } from "@/components/common/stat-card";
import { StatusBadge } from "@/components/common/status-badge";
import { useLiveQuery } from "@/hooks/use-event-source";
import { type LogisticsStats, logisticsApi } from "@/lib/logistics";
import { useCan } from "@/lib/session";

const LOGISTICS_EVENTS = [
  EVENTS.LOGISTICS_ACCREDITED,
  EVENTS.LOGISTICS_BADGE_ROTATED,
  EVENTS.LOGISTICS_PRESENCE_SCAN,
  EVENTS.LOGISTICS_ACTIVITY_SCAN,
  EVENTS.LOGISTICS_MEAL_SCAN_BATCH,
  EVENTS.LOGISTICS_WALLET_PASS_UPDATED,
];

export default function LogisticsStatsPage() {
  const canStats = useCan(CAPABILITIES.LOGISTICS_STATS);
  const stats = useLiveQuery<LogisticsStats>(
    logisticsApi.stats,
    "/api/logistics/stream",
    LOGISTICS_EVENTS,
    { enabled: canStats },
  );

  if (!canStats) {
    return (
      <div className="space-y-6">
        <PageHeader title="Logistics stats" />
        <EmptyState
          icon={LockIcon}
          title="You can't view logistics stats"
          description="The logistics stats capability is required."
        />
      </div>
    );
  }

  const s = stats.data;

  const mealColumns: Column<LogisticsStats["meals"][number]>[] = [
    {
      id: "name",
      header: "Meal",
      sortValue: (m) => m.name,
      cell: (m) => <span className="font-medium">{m.name}</span>,
    },
    {
      id: "served",
      header: "Served",
      align: "right",
      sortValue: (m) => m.served,
      cell: (m) => m.served,
    },
    {
      id: "people",
      header: "People",
      align: "right",
      sortValue: (m) => m.distinctPeople,
      cell: (m) => m.distinctPeople,
    },
    {
      id: "repeat",
      header: "Repeats",
      align: "right",
      sortValue: (m) => m.repeats,
      cell: (m) => m.repeats,
    },
  ];
  const activityColumns: Column<LogisticsStats["activities"][number]>[] = [
    {
      id: "name",
      header: "Activity",
      sortValue: (a) => a.name,
      cell: (a) => <span className="font-medium">{a.name}</span>,
    },
    {
      id: "category",
      header: "Category",
      sortValue: (a) => a.category,
      cell: (a) => <StatusBadge tone="neutral">{a.category}</StatusBadge>,
    },
    {
      id: "scans",
      header: "Scans",
      align: "right",
      sortValue: (a) => a.scans,
      cell: (a) => a.scans,
    },
    {
      id: "attendees",
      header: "People",
      align: "right",
      sortValue: (a) => a.attendees,
      cell: (a) => a.attendees,
    },
  ];

  return (
    <div className="space-y-6" data-wide>
      <PageHeader
        title="Logistics stats"
        description="Live operational panels for accreditation, presence, meals and activities (H27)."
      />

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Accredited"
          value={s?.accreditedCount ?? "—"}
          icon={BadgeCheckIcon}
          hint="Current badge assignments"
        />
        <StatCard
          label="Present now"
          value={s?.currentlyPresent ?? "—"}
          icon={UsersIcon}
          hint="Estimated from scans"
        />
        <StatCard
          label="Meals served"
          value={s ? s.meals.reduce((sum, meal) => sum + meal.served, 0) : "—"}
          icon={SoupIcon}
          hint="Includes repeat servings"
        />
        <StatCard
          label="Activity scans"
          value={s ? s.activities.reduce((sum, activity) => sum + activity.scans, 0) : "—"}
          icon={ActivityIcon}
          hint={stats.connected ? "Live" : "Reconnects automatically"}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <SectionCard title="Meals" icon={SoupIcon}>
          <DataTable
            columns={mealColumns}
            data={s?.meals ?? []}
            getRowId={(row) => String(row.activityId)}
            loading={stats.loading}
            empty={{ icon: SoupIcon, title: "No meal scans yet" }}
          />
        </SectionCard>
        <SectionCard title="Registrable activities" icon={ActivityIcon}>
          <DataTable
            columns={activityColumns}
            data={s?.activities ?? []}
            getRowId={(row) => String(row.activityId)}
            loading={stats.loading}
            empty={{ icon: ActivityIcon, title: "No activity scans yet" }}
          />
        </SectionCard>
      </div>
    </div>
  );
}
