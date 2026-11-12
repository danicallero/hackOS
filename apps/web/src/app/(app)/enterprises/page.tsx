"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { domainScope, EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import { BuildingsIcon } from "@phosphor-icons/react/dist/csr/Buildings";
import { EyeIcon } from "@phosphor-icons/react/dist/csr/Eye";
import { EyeSlashIcon } from "@phosphor-icons/react/dist/csr/EyeSlash";
import { ListNumbersIcon } from "@phosphor-icons/react/dist/csr/ListNumbers";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessDenied } from "@/components/common/access-denied";
import { DataTable } from "@/components/common/data-table";
import { FilterMenu } from "@/components/common/filter-menu";
import { PageHeader } from "@/components/common/page-header";
import { PageLayout } from "@/components/common/page-layout";
import { StaleDataNotice } from "@/components/common/stale-data-notice";
import { Button } from "@/components/ui/button";
import { useLiveQuery } from "@/hooks/use-live-query";
import { api, isNotFoundError } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import { useLocale } from "@/lib/i18n";
import { enterprisesResource, fetchListResource } from "@/lib/list-resources";
import { useCan, useMe } from "@/lib/session";
import { toast } from "@/lib/toast";
import { CreateEnterpriseModal } from "./create-enterprise-modal";
import { buildEnterpriseColumns } from "./enterprise-columns";
import { GroupedEnterprises } from "./grouped-enterprises";
import type { Enterprise } from "./shared";

const ALL = "all";
const NONE = "none";

export default function EnterprisesPage() {
  const { t } = useLocale();
  const router = useRouter();
  const canManage = useCan(CAPABILITIES.SPONSORS_MANAGE);
  const me = useMe();
  // Soft, in-place refresh when another admin creates/edits an enterprise
  // elsewhere. A failed background refetch keeps the list and selection (#1012).
  const {
    data,
    error,
    loading: listLoading,
    stale,
    refetch: load,
  } = useLiveQuery(
    (signal) => fetchListResource<{ enterprises: Enterprise[] }>(enterprisesResource, signal),
    domainScope(SSE_TOPICS.SPONSORS),
    [EVENTS.DOMAIN_CHANGED],
    { resourceKey: enterprisesResource.key, enabled: canManage },
  );
  const enterprises = useMemo(() => data?.enterprises ?? [], [data]);
  const listError =
    error && (data === null || isNotFoundError(error))
      ? apiErrorText(error, t, t("couldNotLoadEnterprises"))
      : null;
  // A sponsor representative without manage access loads their own enterprise instead.
  const [sponsorLoading, setSponsorLoading] = useState(true);
  const [sponsorError, setSponsorError] = useState<string | null>(null);
  const loading = canManage ? listLoading : sponsorLoading;
  const loadError = canManage ? listError : sponsorError;
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [grouped, setGrouped] = useState(false);
  const [kindFilter, setKindFilter] = useState(ALL);
  const [priorityFilter, setPriorityFilter] = useState<string[]>([]);
  const [reordering, setReordering] = useState(false);
  // Keep the admin's selection across live refreshes; drop deleted rows (#1012).
  const [syncedData, setSyncedData] = useState(data);
  if (data !== syncedData) {
    setSyncedData(data);
    const remaining = new Set(enterprises.map((e) => String(e.id)));
    setSelectedIds((current) => {
      const next = new Set([...current].filter((id) => remaining.has(id)));
      return next.size === current.size ? current : next;
    });
  }

  const changeKind = useCallback(
    async (enterprise: Enterprise, kind: Enterprise["kind"]) => {
      if (kind === enterprise.kind) return;
      try {
        await api.patch(`/api/enterprises/${enterprise.id}`, { kind });
        load();
      } catch (err) {
        toast.error(apiErrorText(err, t, t("couldNotUpdateEnterprise")), t("toastCompanyOrder"));
      }
    },
    [load, t],
  );

  const columns = useMemo(() => buildEnterpriseColumns(t, changeKind), [t, changeKind]);

  const priorityOptions = useMemo(
    () =>
      [...new Set(enterprises.map((e) => e.priority))]
        .sort((a, b) => (a ?? Number.POSITIVE_INFINITY) - (b ?? Number.POSITIVE_INFINITY))
        .map((priority) => ({
          value: priority == null ? NONE : String(priority),
          label: priority == null ? t("noPriority") : t("priorityGroupLabel", { priority }),
        })),
    [enterprises, t],
  );
  const visible = useMemo(
    () =>
      enterprises.filter(
        (e) =>
          (kindFilter === ALL || e.kind === kindFilter) &&
          (priorityFilter.length === 0 ||
            priorityFilter.includes(e.priority == null ? NONE : String(e.priority))),
      ),
    [enterprises, kindFilter, priorityFilter],
  );

  const reorder = useCallback(
    async (ids: number[], priority: number) => {
      setReordering(true);
      try {
        await api.post("/api/enterprises/reorder", { ids, priority });
        load();
      } catch (err) {
        toast.error(apiErrorText(err, t, t("couldNotReorder")), t("toastCompanyOrder"));
      } finally {
        setReordering(false);
      }
    },
    [load, t],
  );

  const bulkVisibility = useCallback(
    async (visible: boolean) => {
      const ids = [...selectedIds].map(Number);
      if (ids.length === 0) return;
      setBulkBusy(true);
      try {
        await api.post("/api/enterprises/visibility", { ids, visible });
        toast.success(
          visible
            ? ids.length === 1
              ? t("madeVisibleEnterpriseOne", { count: ids.length })
              : t("madeVisibleEnterpriseOther", { count: ids.length })
            : ids.length === 1
              ? t("hidEnterpriseOne", { count: ids.length })
              : t("hidEnterpriseOther", { count: ids.length }),
          { compactTitle: t("toastCompanyVisibility") },
        );
        setSelectedIds(new Set());
        load();
      } catch (err) {
        toast.error(
          apiErrorText(err, t, t("couldNotUpdateVisibility")),
          t("toastCompanyVisibility"),
        );
      } finally {
        setBulkBusy(false);
      }
    },
    [selectedIds, load, t],
  );

  const isSponsorOnly = !canManage && Boolean(me?.isSponsorRep);
  const sponsorAlive = useRef(true);
  const loadOwnEnterprise = useCallback(() => {
    setSponsorLoading(true);
    setSponsorError(null);
    api
      .get<Enterprise>("/api/enterprises/mine")
      .then((enterprise) => {
        if (sponsorAlive.current) router.replace(`/enterprises/${enterprise.id}`);
      })
      .catch((err) => {
        if (!sponsorAlive.current) return;
        const message = apiErrorText(err, t, t("couldNotLoadYourEnterprise"));
        setSponsorError(message);
        toast.error(message, t("toastDeleteCompany"));
        setSponsorLoading(false);
      });
  }, [router, t]);
  useEffect(() => {
    if (!isSponsorOnly) return;
    sponsorAlive.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading the representative's own enterprise is an external-system sync
    loadOwnEnterprise();
    return () => {
      sponsorAlive.current = false;
    };
  }, [isSponsorOnly, loadOwnEnterprise]);

  if (!canManage && me?.isSponsorRep && loading) {
    return (
      <PageLayout>
        <PageHeader title={t("myEnterprise")} />
        <DataTable
          columns={columns}
          data={[]}
          getRowId={(e) => String(e.id)}
          loading
          empty={{ title: t("loadingEnterprise") }}
        />
      </PageLayout>
    );
  }

  if (!canManage && me?.isSponsorRep && loadError) {
    return (
      <PageLayout>
        <PageHeader title={t("myEnterprise")} />
        <DataTable
          columns={columns}
          data={[]}
          getRowId={(enterprise) => String(enterprise.id)}
          error={{
            message: loadError,
            onRetry: loadOwnEnterprise,
          }}
        />
      </PageLayout>
    );
  }

  if (!canManage) {
    return <AccessDenied ask={t("sponsorsAccessDeniedDesc")} />;
  }

  return (
    <PageLayout>
      {stale && <StaleDataNotice onRetry={() => load()} />}
      <PageHeader
        title={t("enterprises")}
        primaryAction={
          <Button onClick={() => setCreateOpen(true)}>
            <PlusIcon aria-hidden="true" className="size-4" />
            {t("newEnterprise")}
          </Button>
        }
      />

      <div className="flex gap-2">
        <Button
          variant={grouped ? "outline" : "secondary"}
          size="sm"
          onClick={() => setGrouped(false)}
        >
          {t("viewTable")}
        </Button>
        <Button
          variant={grouped ? "secondary" : "outline"}
          size="sm"
          onClick={() => setGrouped(true)}
        >
          {t("viewByPriority")}
        </Button>
        <FilterMenu
          filters={[
            {
              id: "kind",
              label: t("enterpriseKindLabel"),
              icon: BuildingsIcon,
              type: "single",
              value: kindFilter,
              resetValue: ALL,
              onChange: setKindFilter,
              options: [
                { value: ALL, label: t("allGroups") },
                { value: "sponsor", label: t("enterpriseKindSponsor") },
                { value: "collaborator", label: t("enterpriseKindCollaborator") },
              ],
            },
            {
              id: "priority",
              label: t("priorityLabel"),
              icon: ListNumbersIcon,
              type: "multiple",
              value: priorityFilter,
              onChange: setPriorityFilter,
              options: priorityOptions,
            },
          ]}
        />
      </div>

      {grouped ? (
        <GroupedEnterprises
          enterprises={visible}
          columns={columns}
          busy={reordering}
          onMove={reorder}
        />
      ) : (
        <DataTable
          columns={columns}
          data={visible}
          getRowId={(e) => String(e.id)}
          stateKey="enterprises-list"
          getRowHref={(e) => `/enterprises/${e.id}`}
          getRowLabel={(e) => e.name}
          searchable={(e) => `${e.name} ${e.website ?? ""}`}
          searchPlaceholder={t("searchEnterprisesPlaceholder")}
          pageSize={15}
          loading={loading}
          error={loadError ? { message: loadError, onRetry: () => load() } : undefined}
          selectable
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
          toolbar={
            selectedIds.size > 0 ? (
              <>
                <span className="text-muted-foreground text-sm">
                  {t("selectedCount", { count: selectedIds.size })}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={bulkBusy}
                  onClick={() => bulkVisibility(true)}
                  loading={bulkBusy}
                >
                  <EyeIcon aria-hidden="true" className="size-4" />
                  {t("makeVisible")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={bulkBusy}
                  onClick={() => bulkVisibility(false)}
                  loading={bulkBusy}
                >
                  <EyeSlashIcon aria-hidden="true" className="size-4" />
                  {t("hide")}
                </Button>
              </>
            ) : undefined
          }
          empty={{
            title: t("noEnterprisesYetTitle"),
            description: t("createFirstSponsorEnterprise"),
          }}
        />
      )}

      <CreateEnterpriseModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={async (created) => {
          setCreateOpen(false);
          load();
          router.push(`/enterprises/${created.id}`);
        }}
      />
    </PageLayout>
  );
}
