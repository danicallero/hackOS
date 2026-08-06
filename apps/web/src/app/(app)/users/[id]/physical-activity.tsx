"use client";

// Meals and registrable activities consumed by this person (H25-H26).

import { ClipboardListIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { type Column, DataTable } from "@/components/common/data-table";
import { EmptyState } from "@/components/common/empty-state";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
import { StatusBadge } from "@/components/common/status-badge";
import { api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import type { ActivityPass, UserActivity } from "./logs-tab";
import { formatUserDate } from "./shared";

export function PhysicalActivity({
  userId,
  refreshKey,
  embedded = false,
}: {
  userId: number;
  refreshKey?: number;
  embedded?: boolean;
}) {
  const { language, t } = useLocale();
  const [data, setData] = useState<UserActivity | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey is a ping-only nonce from the profile event stream.
  useEffect(() => {
    let cancelled = false;
    setState("loading");
    api
      .get<UserActivity>(`/api/users/${userId}/activity`)
      .then((r) => {
        if (cancelled) return;
        setData(r);
        setState("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [userId, refreshKey]);

  if (state === "loading") {
    return (
      <div className="flex justify-center py-12">
        <Spinner className="size-5" />
      </div>
    );
  }
  if (state === "error" || !data) {
    return (
      <EmptyState
        icon={ClipboardListIcon}
        title={t("couldNotLoadActivityTitle")}
        description={t("passesUnavailable")}
      />
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
        <StatusBadge tone={p.category === "meal" ? "success" : "info"} dot={false}>
          {p.category === "meal" ? t("typeMeal") : t("typeWorkshop")}
        </StatusBadge>
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
        icon: ClipboardListIcon,
        title: t("noPassesYet"),
        description: t("passesWillAppear"),
      }}
    />
  );

  if (embedded) return table;

  return (
    <SectionCard icon={ClipboardListIcon} title={t("activityPasses")} bodyClassName="p-0">
      {table}
    </SectionCard>
  );
}
