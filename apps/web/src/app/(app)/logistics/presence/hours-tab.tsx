"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { DownloadIcon, UsersIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { type Column, DataTable } from "@/components/common/data-table";
import { SectionCard } from "@/components/common/section-card";
import { Field } from "@/components/logistics/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { API_URL } from "@/lib/env";
import { useLocale } from "@/lib/i18n";
import type { PresenceHours } from "@/lib/logistics";
import { useCan } from "@/lib/session";

// ── Hours tab: min-hours filter + CSV exports (H54) ────────────────────────

export function HoursTab({
  hours,
  loading,
  hoursError,
}: {
  hours: PresenceHours[];
  loading: boolean;
  hoursError?: { message: string; onRetry: () => void };
}) {
  const { t } = useLocale();
  const canExport = useCan(CAPABILITIES.LOGISTICS_STATS);
  const [minHours, setMinHours] = useState("");

  const filtered = useMemo(() => {
    const min = Number(minHours);
    if (!minHours.trim() || Number.isNaN(min)) return hours;
    return hours.filter((row) => row.hours >= min);
  }, [hours, minHours]);

  const exportHref = (format: "reduced" | "full") => {
    const params = new URLSearchParams({ format });
    if (filtered.length) params.set("userIds", filtered.map((row) => row.userId).join(","));
    return `${API_URL}/api/presence/hours/export.csv?${params.toString()}`;
  };

  const columns: Column<PresenceHours>[] = [
    {
      id: "user",
      header: t("columnUser"),
      sortValue: (row) => `${row.surname ?? ""} ${row.name ?? ""}`.trim().toLowerCase(),
      cell: (row) => {
        const name = [row.name, row.surname].filter(Boolean).join(" ").trim();
        return name ? (
          <span>{name}</span>
        ) : (
          <span className="text-muted-foreground font-mono text-sm">#{row.userId}</span>
        );
      },
    },
    {
      id: "hours",
      header: t("columnHours"),
      align: "right",
      sortValue: (row) => row.hours,
      cell: (row) => <span className="font-mono tabular-nums">{row.hours.toFixed(2)}</span>,
    },
  ];

  return (
    <SectionCard
      title={t("attendanceHours")}
      description={t("attendanceHoursDesc")}
      icon={UsersIcon}
      action={
        <div className="flex flex-wrap items-end gap-2">
          <Field id="min-hours" label={t("minHoursLabel")}>
            <Input
              id="min-hours"
              type="number"
              min={0}
              step="0.5"
              className="w-24"
              value={minHours}
              onChange={(e) => setMinHours(e.target.value)}
              placeholder="0"
            />
          </Field>
          {canExport && (
            <>
              <Button asChild variant="outline">
                <a href={exportHref("reduced")}>
                  <DownloadIcon className="size-4" aria-hidden="true" />
                  {t("exportHoursReduced")}
                </a>
              </Button>
              <Button asChild variant="outline">
                <a href={exportHref("full")}>
                  <DownloadIcon className="size-4" aria-hidden="true" />
                  {t("exportHoursDetailed")}
                </a>
              </Button>
            </>
          )}
        </div>
      }
    >
      <DataTable
        columns={columns}
        data={filtered}
        getRowId={(row) => String(row.userId)}
        getRowHref={(row) => `/users/${row.userId}?tab=presence`}
        getRowLabel={(row) => `${row.name ?? ""} ${row.surname ?? ""}`.trim() || String(row.userId)}
        loading={loading}
        searchable={(row) => `${row.userId} ${row.name ?? ""} ${row.surname ?? ""} ${row.hours}`}
        searchPlaceholder={t("filterUsers")}
        pageSize={10}
        error={hoursError}
        empty={{
          icon: UsersIcon,
          title: t("noPresenceYet"),
          description: t("noPresenceYetDesc"),
        }}
      />
    </SectionCard>
  );
}
