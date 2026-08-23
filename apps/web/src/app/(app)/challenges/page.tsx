"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS } from "@hackos/shared/events";
import { EyeIcon, EyeOffIcon, PlusIcon, TrophyIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AccessDenied } from "@/components/common/access-denied";
import { type Column, DataTable } from "@/components/common/data-table";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { ApiError, api } from "@/lib/api";
import { formatScheduledDateTime } from "@/lib/datetime";
import { LOCALE_CODES, type Translate, useLocale } from "@/lib/i18n";
import { useSessionContext } from "@/lib/session";
import {
  type Challenge,
  canAccessSponsorWorkspace,
  isScheduled,
  textForDisplay,
  textForSearch,
  visibilityTone,
} from "./shared";

function buildColumns(t: Translate, locale: string): Column<Challenge>[] {
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
      cell: (c) => (
        <StatusBadge tone={visibilityTone(c.visibility)} className="capitalize">
          {c.visibility}
        </StatusBadge>
      ),
    },
    {
      id: "reveal",
      header: t("colReveal"),
      sortValue: (c) => c.available_from ?? "",
      cell: (c) => {
        if (c.visibility === "hidden" && isScheduled(c.available_from)) {
          return (
            <div className="flex items-center gap-2">
              <StatusBadge tone="warning">{t("dataStatusScheduled")}</StatusBadge>
              <span className="text-muted-foreground text-sm">
                {formatScheduledDateTime(c.available_from as string, locale)}
              </span>
            </div>
          );
        }
        if (c.visibility === "visible") {
          return (
            <span className="text-muted-foreground text-sm">
              {c.available_from
                ? formatScheduledDateTime(c.available_from, locale)
                : t("immediate")}
            </span>
          );
        }
        return <span className="text-muted-foreground">—</span>;
      },
    },
  ];
}

export default function ChallengesPage() {
  const router = useRouter();
  const { t, language } = useLocale();
  const { canAny, me } = useSessionContext();
  const canAdmin = canAny(CAPABILITIES.SPONSORS_MANAGE, CAPABILITIES.QUEUE_ADMIN);
  const canSee = canAccessSponsorWorkspace(canAdmin, Boolean(me?.isSponsorRep));
  const columns = useMemo(() => buildColumns(t, LOCALE_CODES[language]), [t, language]);
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const load = useCallback(async () => {
    if (!canSee) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const path = canAdmin ? "/api/challenges" : "/api/challenges/mine";
      const res = await api.get<{ challenges: Challenge[] }>(path);
      setChallenges(res.challenges);
      setSelectedIds(new Set());
    } catch (err) {
      setChallenges([]);
      const message = err instanceof ApiError ? err.message : t("couldNotLoadChallenges");
      setLoadError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [canAdmin, canSee, t]);

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
        );
        await load();
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : t("couldNotUpdateVisibility"));
      } finally {
        setBulkBusy(false);
      }
    },
    [selectedIds, load, t],
  );

  // Soft, in-place refresh instead of a hard reload when another admin
  // creates/edits a challenge elsewhere.
  const liveRefresh = useAutoRefresh("/api/events/stream", [EVENTS.DATA_CHANGED]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: liveRefresh is a ping-only nonce, intentionally added to retrigger this effect.
  useEffect(() => {
    // fetching challenges list from the API on mount/refresh is a legitimate external-system sync
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, liveRefresh]);

  if (!canSee) {
    return <AccessDenied ask={t("challengesAccessDeniedDesc")} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={canAdmin ? t("challenges") : t("myChallenges")}
        actions={
          canAdmin ? (
            <Button onClick={() => router.push("/challenges/new")}>
              <PlusIcon className="size-4" />
              {t("newChallenge")}
            </Button>
          ) : undefined
        }
      />

      <DataTable
        columns={columns}
        data={challenges}
        getRowId={(c) => String(c.id)}
        getRowHref={(c) => `/challenges/${c.id}`}
        getRowLabel={(c) => textForDisplay(c.title)}
        searchable={(c) =>
          `${textForSearch(c.title)} ${textForSearch(c.description)} ${textForSearch(c.criteria)}`
        }
        searchPlaceholder={t("searchChallengesPlaceholder")}
        pageSize={15}
        loading={loading}
        error={loadError ? { message: loadError, onRetry: load } : undefined}
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
              >
                <EyeIcon className="size-4" />
                {t("makeVisible")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={bulkBusy}
                onClick={() => bulkVisibility(false)}
              >
                <EyeOffIcon className="size-4" />
                {t("hide")}
              </Button>
            </>
          ) : undefined
        }
        empty={{
          icon: TrophyIcon,
          title: t("noChallengesYetTitle"),
          description: canAdmin ? t("createFirstEnterpriseChallenge") : t("noChallengeAssignedYet"),
        }}
      />
    </div>
  );
}
