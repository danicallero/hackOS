"use client";

import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
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
      setError(errorMessage(err, t, t("couldNotLoadPeople")));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const renderStatuses = (row: PersonDirectoryEntry) => (
    <span className="flex flex-wrap gap-x-4 gap-y-1.5">
      <StatusBadge tone={row.confirmed ? "success" : "warning"}>
        {row.confirmed ? t("confirmed") : t("notConfirmed")}
      </StatusBadge>
      <StatusBadge tone={row.eventAccess ? "success" : "danger"}>
        {row.eventAccess ? t("eventAccessStatus") : t("noEventAccessStatus")}
      </StatusBadge>
      <StatusBadge tone={row.present ? "success" : "neutral"}>
        {row.present ? t("currentlyInside") : t("currentlyOutside")}
      </StatusBadge>
    </span>
  );

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
      cell: renderStatuses,
    },
  ];

  return (
    <SectionCard variant="plain">
      <DataTable
        columns={columns}
        data={people}
        getRowId={(row) => String(row.userId)}
        onRowClick={(row) => onOpenPerson(row.userId)}
        getRowLabel={(row) =>
          [row.name, row.surname].filter(Boolean).join(" ") || String(row.userId)
        }
        renderMobileRow={(row) => (
          <button
            type="button"
            onClick={() => onOpenPerson(row.userId)}
            className="button-interaction flex w-full items-start gap-3 px-4 py-3 text-left"
          >
            <span className="min-w-0 flex-1 space-y-2">
              <span className="block wrap-anywhere text-sm font-medium">
                {[row.name, row.surname].filter(Boolean).join(" ") || `#${row.userId}`}
              </span>
              {row.email && (
                <span className="text-muted-foreground block wrap-anywhere text-xs">
                  {row.email}
                </span>
              )}
              <span className="text-muted-foreground block wrap-anywhere text-xs">
                {row.badgeId ?? t("noBadge")}
              </span>
              {renderStatuses(row)}
            </span>
            <CaretRightIcon
              aria-hidden="true"
              className="text-muted-foreground mt-1 size-4 shrink-0"
            />
          </button>
        )}
        loading={loading}
        searchable={(row) =>
          [row.name, row.surname, row.email, row.badgeId, row.dni].filter(Boolean).join(" ")
        }
        searchPlaceholder={t("peopleSearchPlaceholder")}
        pageSize={20}
        error={error ? { message: error, onRetry: load } : undefined}
        empty={{ title: t("noPeopleYet") }}
      />
    </SectionCard>
  );
}
