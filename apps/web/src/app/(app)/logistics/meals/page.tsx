"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS } from "@hackos/shared/events";
import { LockIcon, SoupIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { type Column, DataTable } from "@/components/common/data-table";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { ActivityScannerCard } from "@/components/logistics/activity-scanner";
import { errorMessage } from "@/components/logistics/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { logisticsApi, type ScannableActivity } from "@/lib/logistics";
import { useCan } from "@/lib/session";
import type { UserList, UserListItem } from "@/lib/types";

export default function MealsPage() {
  const { t } = useLocale();
  const canScan = useCan(CAPABILITIES.ACTIVITY_SCAN);
  const canManage = useCan(CAPABILITIES.SCHEDULE_MANAGE);

  if (!canScan) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("meals")} />
        <EmptyState
          icon={LockIcon}
          title={t("mealsDeniedTitle")}
          description={t("mealsDeniedDesc")}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6" data-wide>
      <PageHeader title={t("meals")} description={t("mealsDescription")} />
      <ActivityScannerCard category="meal" />
      {canManage && <EntitlementPanel />}
    </div>
  );
}

function EntitlementPanel() {
  const { t } = useLocale();
  const [meals, setMeals] = useState<ScannableActivity[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [user, setUser] = useState<UserListItem | null>(null);
  const [userQuery, setUserQuery] = useState("");
  const [userResults, setUserResults] = useState<UserListItem[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    logisticsApi
      .scannableActivities("meal")
      .then((r) => setMeals(r.items))
      .catch(() => setMeals([]));
  }, []);

  // Soft, in-place refresh instead of a hard reload when meal scans/grants
  // happen elsewhere.
  const liveRefresh = useAutoRefresh("/api/logistics/stream", [EVENTS.LOGISTICS_MEAL_SCAN_BATCH]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: liveRefresh is a ping-only nonce, intentionally added to retrigger this effect.
  useEffect(() => load(), [load, liveRefresh]);

  const selected = [...selectedIds].map(Number);

  const searchUsers = async () => {
    try {
      const result = await api.get<UserList>("/api/users", {
        query: { q: userQuery.trim() || undefined, limit: 8 },
      });
      setUserResults(result.users);
    } catch (err) {
      toast.error(errorMessage(err, t("userSearchFailed")));
    }
  };

  const grantSelected = async () => {
    if (!user) return;
    setBusy(true);
    try {
      await Promise.all(selected.map((id) => logisticsApi.grantEntitlement(id, user.id)));
      toast.success(t("mealEntitlementsGranted", { count: selected.length }));
      setUser(null);
      setUserResults([]);
      setUserQuery("");
      load();
    } catch (err) {
      toast.error(errorMessage(err, t("couldNotGrantEntitlements")));
    } finally {
      setBusy(false);
    }
  };

  const bulkConfirmed = async () => {
    setBusy(true);
    try {
      const results = await Promise.all(selected.map((id) => logisticsApi.bulkGrantConfirmed(id)));
      const total = results.reduce((sum, result) => sum + result.granted, 0);
      toast.success(t("confirmedEntitlementsGranted", { total }));
      load();
    } catch (err) {
      toast.error(errorMessage(err, t("couldNotBulkGrant")));
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<ScannableActivity>[] = [
    {
      id: "name",
      header: t("columnMeal"),
      sortValue: (m) => m.name,
      cell: (m) => <span className="font-medium">{m.name}</span>,
    },
    {
      id: "served",
      header: t("columnServed"),
      align: "right",
      sortValue: (m) => m.count,
      cell: (m) => m.count,
    },
    {
      id: "distinct",
      header: t("columnPeople"),
      align: "right",
      sortValue: (m) => m.distinctPeople,
      cell: (m) => m.distinctPeople,
    },
    {
      id: "repeats",
      header: t("columnRepeats"),
      align: "right",
      sortValue: (m) => m.repeats,
      cell: (m) => m.repeats,
    },
  ];

  return (
    <SectionCard
      title={t("mealEntitlements")}
      description={t("mealEntitlementsDesc")}
      icon={SoupIcon}
    >
      <DataTable
        columns={columns}
        data={meals}
        getRowId={(meal) => String(meal.activityId)}
        selectable
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        searchable={(meal) => meal.name}
        empty={{ icon: SoupIcon, title: t("noMealsYet") }}
        toolbar={
          selectedIds.size > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground text-sm">
                {t("selectedCount", { count: selectedIds.size })}
              </span>
              <Input
                value={
                  user ? `${user.name ?? ""} ${user.surname ?? ""}`.trim() || user.email : userQuery
                }
                onChange={(e) => {
                  setUser(null);
                  setUserQuery(e.target.value);
                }}
                placeholder={t("findUserShortPlaceholder")}
                className="h-9 w-44"
              />
              <Button size="sm" variant="outline" onClick={searchUsers} disabled={busy || !!user}>
                {t("search")}
              </Button>
              <Button size="sm" variant="outline" disabled={busy || !user} onClick={grantSelected}>
                {t("grantUser")}
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={bulkConfirmed}>
                {t("grantConfirmed")}
              </Button>
            </div>
          ) : undefined
        }
      />
      {userResults.length > 0 && !user && (
        <div className="mt-3 rounded-lg border">
          {userResults.map((u) => (
            <button
              key={u.id}
              type="button"
              className="hover:bg-muted flex w-full items-center justify-between gap-3 border-b px-3 py-2 text-left last:border-b-0"
              onClick={() => {
                setUser(u);
                setUserResults([]);
              }}
            >
              <span className="text-sm font-medium">
                {[u.name, u.surname].filter(Boolean).join(" ") || u.email}
              </span>
              <span className="text-muted-foreground text-xs">{u.email}</span>
            </button>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
