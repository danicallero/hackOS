"use client";

import { UsersIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { type Column, DataTable } from "@/components/common/data-table";
import { SectionCard } from "@/components/common/section-card";
import { StatusBadge } from "@/components/common/status-badge";
import { errorMessage } from "@/components/logistics/ui";
import { useLocale } from "@/lib/i18n";
import { logisticsApi, type PersonDirectoryEntry } from "@/lib/logistics";

// ── People tab: full roster finder, mirrors the mobile scanner directory ──

export function PeopleTab({ onOpenPerson }: { onOpenPerson: (userId: number) => void }) {
  const { t } = useLocale();
  const [people, setPeople] = useState<PersonDirectoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { items } = await logisticsApi.listPeople();
      setPeople(items);
    } catch (err) {
      setError(errorMessage(err, t("couldNotLoadPeople")));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const columns: Column<PersonDirectoryEntry>[] = [
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
      id: "email",
      header: t("email"),
      cell: (row) => row.email ?? "—",
      sortValue: (row) => row.email ?? "",
    },
    {
      id: "badge",
      header: t("badge"),
      cell: (row) => row.badgeId ?? t("noBadge"),
      sortValue: (row) => row.badgeId ?? "",
    },
    {
      id: "status",
      header: t("statusColumn"),
      cell: (row) => (
        <div className="flex flex-wrap gap-2">
          <StatusBadge tone={row.confirmed ? "success" : "warning"} dot={false}>
            {row.confirmed ? t("confirmed") : t("notConfirmed")}
          </StatusBadge>
          <StatusBadge tone={row.present ? "success" : "neutral"} dot={false}>
            {row.present ? t("currentlyInside") : t("currentlyOutside")}
          </StatusBadge>
        </div>
      ),
    },
  ];

  return (
    <SectionCard title={t("peopleTab")} icon={UsersIcon}>
      <DataTable
        columns={columns}
        data={people}
        getRowId={(row) => String(row.userId)}
        onRowClick={(row) => onOpenPerson(row.userId)}
        getRowLabel={(row) =>
          [row.name, row.surname].filter(Boolean).join(" ") || String(row.userId)
        }
        loading={loading}
        searchable={(row) =>
          [row.name, row.surname, row.email, row.badgeId, row.dni].filter(Boolean).join(" ")
        }
        searchPlaceholder={t("peopleSearchPlaceholder")}
        pageSize={20}
        error={error ? { message: error, onRetry: load } : undefined}
        empty={{ icon: UsersIcon, title: t("noPeopleYet") }}
      />
    </SectionCard>
  );
}
