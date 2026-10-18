"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { domainScope, EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import { BuildingsIcon } from "@phosphor-icons/react/dist/csr/Buildings";
import { EyeIcon } from "@phosphor-icons/react/dist/csr/Eye";
import { EyeSlashIcon } from "@phosphor-icons/react/dist/csr/EyeSlash";
import { ListNumbersIcon } from "@phosphor-icons/react/dist/csr/ListNumbers";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AccessDenied } from "@/components/common/access-denied";
import { DataTable } from "@/components/common/data-table";
import { FilterMenu } from "@/components/common/filter-menu";
import { PageHeader } from "@/components/common/page-header";
import { PageLayout } from "@/components/common/page-layout";
import { StaleDataNotice } from "@/components/common/stale-data-notice";
import { Button } from "@/components/ui/button";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { useBackgroundRefresh } from "@/hooks/use-background-refresh";
import { api } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import { LOCALE_CODES, useLocale } from "@/lib/i18n";
import { useCan, useMe } from "@/lib/session";
import { toast } from "@/lib/toast";
import { CreateEnterpriseModal } from "./create-enterprise-modal";
import { buildEnterpriseColumns } from "./enterprise-columns";
import { GroupedEnterprises } from "./grouped-enterprises";
import type { Enterprise } from "./shared";

const ALL = "all";
const NONE = "none";

export default function EnterprisesPage() {
  const { t, language } = useLocale();
  const router = useRouter();
  const canManage = useCan(CAPABILITIES.SPONSORS_MANAGE);
  const me = useMe();
  const [enterprises, setEnterprises] = useState<Enterprise[]>([]);
  const [loading, setLoading] = useState(true);
  const { succeeded, failed, hasLoaded, stale, retryNonce } = useBackgroundRefresh();
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sponsorRetryNonce, setSponsorRetryNonce] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [grouped, setGrouped] = useState(false);
  const [kindFilter, setKindFilter] = useState(ALL);
  const [priorityFilter, setPriorityFilter] = useState<string[]>([]);
  const [reordering, setReordering] = useState(false);

  const load = useCallback(async () => {
    if (!hasLoaded()) setLoading(true);
    try {
      const r = await api.get<{ enterprises: Enterprise[] }>("/api/enterprises");
      succeeded();
      setLoadError(null);
      setEnterprises(r.enterprises);
      // Keep the admin's selection across live refreshes; drop deleted rows (#1012).
      const remaining = new Set(r.enterprises.map((e) => String(e.id)));
      setSelectedIds((current) => {
        const next = new Set([...current].filter((id) => remaining.has(id)));
        return next.size === current.size ? current : next;
      });
    } catch (err) {
      // A failed background refresh keeps the list and selection (#1012).
      if (!failed(err)) return;
      setEnterprises([]);
      setLoadError(apiErrorText(err, t, t("couldNotLoadEnterprises")));
    } finally {
      setLoading(false);
    }
  }, [t, succeeded, failed, hasLoaded]);

  const changeKind = useCallback(
    async (enterprise: Enterprise, kind: Enterprise["kind"]) => {
      if (kind === enterprise.kind) return;
      try {
        await api.patch(`/api/enterprises/${enterprise.id}`, { kind });
        await load();
      } catch (err) {
        toast.error(apiErrorText(err, t, t("couldNotUpdateEnterprise")), t("toastCompanyOrder"));
      }
    },
    [load, t],
  );

  const columns = useMemo(
    () => buildEnterpriseColumns(t, LOCALE_CODES[language], changeKind),
    [t, language, changeKind],
  );

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
        await load();
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
        await load();
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

  // Soft, in-place refresh instead of a hard reload when another admin
  // creates/edits an enterprise elsewhere.
  const liveRefresh = useAutoRefresh(domainScope(SSE_TOPICS.SPONSORS), [EVENTS.DOMAIN_CHANGED]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: liveRefresh is a ping-only nonce, intentionally added to retrigger this effect.
  useEffect(() => {
    if (canManage) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void load();
      return;
    }
    if (!me?.isSponsorRep) {
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    setLoadError(null);
    api
      .get<Enterprise>("/api/enterprises/mine")
      .then((enterprise) => {
        if (alive) router.replace(`/enterprises/${enterprise.id}`);
      })
      .catch((err) => {
        if (!alive) return;
        const message = apiErrorText(err, t, t("couldNotLoadYourEnterprise"));
        setLoadError(message);
        toast.error(message, t("toastDeleteCompany"));
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [
    canManage,
    load,
    me?.isSponsorRep,
    me?.visibleRoleName,
    router,
    liveRefresh,
    sponsorRetryNonce,
    retryNonce,
    t,
  ]);

  if (!canManage && me?.isSponsorRep && loading) {
    return (
      <PageLayout>
        <PageHeader title={t("myEnterprise")} />
        <DataTable
          columns={columns}
          data={[]}
          getRowId={(e) => String(e.id)}
          loading
          empty={{ icon: BuildingsIcon, title: t("loadingEnterprise") }}
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
            onRetry: () => setSponsorRetryNonce((value) => value + 1),
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
      {stale && <StaleDataNotice onRetry={() => void load()} />}
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
          loading={loading && !hasLoaded()}
          error={loadError ? { message: loadError, onRetry: load } : undefined}
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
            icon: BuildingsIcon,
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
          await load();
          router.push(`/enterprises/${created.id}`);
        }}
      />
    </PageLayout>
  );
}
