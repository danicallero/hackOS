"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { domainScope, EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import { EyeIcon } from "@phosphor-icons/react/dist/csr/Eye";
import { EyeSlashIcon } from "@phosphor-icons/react/dist/csr/EyeSlash";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { AccessDenied } from "@/components/common/access-denied";
import { type Column, DataTable } from "@/components/common/data-table";
import { PageHeader } from "@/components/common/page-header";
import { PageLayout } from "@/components/common/page-layout";
import { RevealCell, VisibilityBadge } from "@/components/common/publication-status";
import { StaleDataNotice } from "@/components/common/stale-data-notice";
import { Button } from "@/components/ui/button";
import { useLiveQuery } from "@/hooks/use-live-query";
import { api, isNotFoundError } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import {
  type Challenge,
  canAccessSponsorWorkspace,
  textForDisplay,
  textForSearch,
} from "@/lib/challenges";
import { type Translate, useLocale } from "@/lib/i18n";
import { challengesResource, fetchListResource } from "@/lib/list-resources";
import { useSessionContext } from "@/lib/session";
import { toast } from "@/lib/toast";

function buildColumns(t: Translate): Column<Challenge>[] {
  return [
    {
      id: "title",
      header: t("colChallenge"),
      sortValue: (c) => textForDisplay(c.title).toLowerCase(),
      cell: (c) => <span className="font-medium">{textForDisplay(c.title)}</span>,
    },
    {
      id: "enterprise",
      header: t("colEnterprise"),
      sortValue: (c) => (c.enterprise_name ?? "").toLowerCase(),
      cell: (c) =>
        c.enterprise_name ? (
          <span className="text-muted-foreground text-sm">{c.enterprise_name}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: "visibility",
      header: t("colVisibility"),
      sortValue: (c) => c.visibility,
      cell: (c) => <VisibilityBadge visibility={c.visibility} />,
    },
    {
      id: "reveal",
      header: t("colReveal"),
      sortValue: (c) => c.available_from ?? "",
      cell: (c) => <RevealCell visibility={c.visibility} availableFrom={c.available_from} />,
    },
  ];
}

export default function ChallengesPage() {
  const router = useRouter();
  const { t } = useLocale();
  const { canAny, me } = useSessionContext();
  const canAdmin = canAny(CAPABILITIES.SPONSORS_MANAGE, CAPABILITIES.QUEUE_ADMIN);
  const canSee = canAccessSponsorWorkspace(canAdmin, Boolean(me?.isSponsorRep));
  const columns = useMemo(() => buildColumns(t), [t]);
  const resource = challengesResource(canAdmin);
  // Soft, in-place refresh when another admin creates/edits a challenge
  // elsewhere. A failed background refetch keeps the list and selection (#1012).
  const {
    data,
    error,
    loading,
    stale,
    refetch: load,
  } = useLiveQuery(
    (signal) => fetchListResource<{ challenges: Challenge[] }>(resource, signal),
    domainScope(SSE_TOPICS.SPONSORS),
    [EVENTS.DOMAIN_CHANGED],
    { resourceKey: resource.key, enabled: canSee },
  );
  const challenges = useMemo(() => data?.challenges ?? [], [data]);
  const loadError =
    error && (data === null || isNotFoundError(error))
      ? apiErrorText(error, t, t("couldNotLoadChallenges"))
      : null;
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  // Keep the admin's selection across live refreshes; drop deleted rows (#1012).
  const [syncedData, setSyncedData] = useState(data);
  if (data !== syncedData) {
    setSyncedData(data);
    const remaining = new Set(challenges.map((c) => String(c.id)));
    setSelectedIds((current) => {
      const next = new Set([...current].filter((id) => remaining.has(id)));
      return next.size === current.size ? current : next;
    });
  }

  const bulkVisibility = useCallback(
    async (visible: boolean) => {
      const ids = [...selectedIds].map(Number);
      if (ids.length === 0) return;
      setBulkBusy(true);
      try {
        await api.post("/api/challenges/visibility", { ids, visible });
        toast.success(
          visible
            ? ids.length === 1
              ? t("madeVisibleOne", { count: ids.length })
              : t("madeVisibleOther", { count: ids.length })
            : ids.length === 1
              ? t("hidCountOne", { count: ids.length })
              : t("hidCountOther", { count: ids.length }),
          { compactTitle: t("toastChallengeVisibility") },
        );
        setSelectedIds(new Set());
        load();
      } catch (err) {
        toast.error(
          apiErrorText(err, t, t("couldNotUpdateVisibility")),
          t("toastChallengeVisibility"),
        );
      } finally {
        setBulkBusy(false);
      }
    },
    [selectedIds, load, t],
  );

  if (!canSee) {
    return <AccessDenied ask={t("challengesAccessDeniedDesc")} />;
  }

  return (
    <PageLayout>
      {stale && <StaleDataNotice onRetry={() => load()} />}
      <PageHeader
        title={canAdmin ? t("challenges") : t("myChallenges")}
        primaryAction={
          canAdmin ? (
            <Button onClick={() => router.push("/challenges/new")}>
              <PlusIcon aria-hidden="true" className="size-4" />
              {t("newChallenge")}
            </Button>
          ) : undefined
        }
      />

      <DataTable
        columns={columns}
        data={challenges}
        getRowId={(c) => String(c.id)}
        stateKey="challenges-list"
        getRowHref={(c) => `/challenges/${c.id}`}
        getRowLabel={(c) => textForDisplay(c.title)}
        searchable={(c) =>
          `${textForSearch(c.title)} ${textForSearch(c.description)} ${textForSearch(c.criteria)}`
        }
        searchPlaceholder={t("searchChallengesPlaceholder")}
        pageSize={15}
        loading={loading}
        error={loadError ? { message: loadError, onRetry: () => load() } : undefined}
        selectable={canAdmin}
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        toolbar={
          canAdmin && selectedIds.size > 0 ? (
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
          title: t("noChallengesYetTitle"),
          description: canAdmin ? t("createFirstEnterpriseChallenge") : t("noChallengeAssignedYet"),
        }}
      />
    </PageLayout>
  );
}
