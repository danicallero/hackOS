"use client";

// Reviews overview (H46 gap-fill): every evaluation across the event, filterable
// by room/challenge/status, with the judges involved and a sortable "nota".
// Access is scoped server-side — admins see everything, a sponsor rep only
// ever sees their own enterprise's challenges (see api reviews.ts).

import { ClipboardListIcon, DownloadIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { type Column, DataTable } from "@/components/common/data-table";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ApiError, api } from "@/lib/api";
import { API_URL } from "@/lib/env";
import { useLocale } from "@/lib/i18n";

interface ReviewRow {
  entryId: number;
  challengeId: number;
  challengeTitle: string;
  repoId: number;
  repoName: string;
  roomId: number | null;
  roomName: string | null;
  status: "draft" | "submitted" | null;
  nota: number | null;
  judges: string[];
  updatedAt: string | null;
}

const ALL = "__all__";

export default function ReviewsOverviewPage() {
  const { t } = useLocale();
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [roomFilter, setRoomFilter] = useState(ALL);
  const [challengeFilter, setChallengeFilter] = useState(ALL);
  const [statusFilter, setStatusFilter] = useState(ALL);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const query: Record<string, string> = {};
      if (roomFilter !== ALL) query.roomId = roomFilter;
      if (challengeFilter !== ALL) query.challengeId = challengeFilter;
      if (statusFilter !== ALL) query.status = statusFilter;
      const { reviews: data } = await api.get<{ reviews: ReviewRow[] }>("/api/queue/reviews", {
        query,
      });
      setReviews(data);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : t("couldNotLoadReviews"));
    } finally {
      setLoading(false);
    }
  }, [roomFilter, challengeFilter, statusFilter, t]);

  useEffect(() => {
    void load();
  }, [load]);

  // Filter options are derived from an unfiltered load's worth of rows the
  // caller can already see — no separate rooms/challenges fetch, and no risk
  // of listing a challenge/room this caller isn't scoped to.
  const [allRooms, setAllRooms] = useState<Array<{ id: number; name: string }>>([]);
  const [allChallenges, setAllChallenges] = useState<Array<{ id: number; title: string }>>([]);
  useEffect(() => {
    api
      .get<{ reviews: ReviewRow[] }>("/api/queue/reviews")
      .then(({ reviews: data }) => {
        setAllRooms(
          Array.from(
            new Map(
              data
                .filter((r) => r.roomId != null && r.roomName != null)
                .map((r) => [
                  r.roomId as number,
                  { id: r.roomId as number, name: r.roomName as string },
                ]),
            ).values(),
          ),
        );
        setAllChallenges(
          Array.from(
            new Map(
              data.map((r) => [r.challengeId, { id: r.challengeId, title: r.challengeTitle }]),
            ).values(),
          ),
        );
      })
      .catch(() => {
        setAllRooms([]);
        setAllChallenges([]);
      });
  }, []);

  const columns = useMemo<Column<ReviewRow>[]>(
    () => [
      {
        id: "challenge",
        header: t("colChallenge"),
        sortValue: (r) => r.challengeTitle.toLowerCase(),
        cell: (r) => <span className="font-medium">{r.challengeTitle}</span>,
      },
      {
        id: "room",
        header: t("colRoom"),
        sortValue: (r) => r.roomName?.toLowerCase() ?? "",
        cell: (r) => r.roomName ?? <span className="text-muted-foreground text-sm">—</span>,
      },
      {
        id: "project",
        header: t("colProject"),
        sortValue: (r) => r.repoName.toLowerCase(),
        cell: (r) => r.repoName,
      },
      {
        id: "status",
        header: t("statusColumn"),
        sortValue: (r) => r.status ?? "",
        cell: (r) =>
          r.status === "submitted" ? (
            <StatusBadge tone="success">{t("challengeReviewSubmitted")}</StatusBadge>
          ) : r.status === "draft" ? (
            <StatusBadge tone="info">{t("challengeReviewDraft")}</StatusBadge>
          ) : (
            <StatusBadge tone="neutral">{t("challengeReviewNotStarted")}</StatusBadge>
          ),
      },
      {
        id: "nota",
        header: t("notaLabel"),
        align: "right",
        sortValue: (r) => r.nota ?? -Infinity,
        cell: (r) => (r.nota !== null ? r.nota : <span className="text-muted-foreground">—</span>),
      },
      {
        id: "judges",
        header: t("colJudges"),
        cell: (r) =>
          r.judges.length === 0 ? (
            <span className="text-muted-foreground text-sm">—</span>
          ) : (
            <span className="text-sm">{r.judges.join(", ")}</span>
          ),
      },
    ],
    [t],
  );

  const exportHref = useMemo(() => {
    const params = new URLSearchParams();
    if (roomFilter !== ALL) params.set("roomId", roomFilter);
    if (challengeFilter !== ALL) params.set("challengeId", challengeFilter);
    if (statusFilter !== ALL) params.set("status", statusFilter);
    const qs = params.toString();
    return `${API_URL}/api/queue/reviews/export.csv${qs ? `?${qs}` : ""}`;
  }, [roomFilter, challengeFilter, statusFilter]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("reviewsOverview")}
        description={t("reviewsOverviewDesc")}
        actions={
          <Button asChild variant="outline">
            <a href={exportHref} onClick={() => toast.success(t("exportStarted"))}>
              <DownloadIcon className="size-4" />
              {t("exportCsv")}
            </a>
          </Button>
        }
      />

      <div className="flex flex-wrap gap-3">
        <Select value={challengeFilter} onValueChange={setChallengeFilter}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder={t("filterByChallenge")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("allChallenges")}</SelectItem>
            {allChallenges.map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>
                {c.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={roomFilter} onValueChange={setRoomFilter}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder={t("filterByRoom")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("allRooms")}</SelectItem>
            {allRooms.map((room) => (
              <SelectItem key={room.id} value={String(room.id)}>
                {room.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder={t("filterByStatus")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("allStatuses")}</SelectItem>
            <SelectItem value="submitted">{t("challengeReviewSubmitted")}</SelectItem>
            <SelectItem value="draft">{t("challengeReviewDraft")}</SelectItem>
            <SelectItem value="none">{t("challengeReviewNotStarted")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <DataTable
        columns={columns}
        data={reviews}
        getRowId={(r) => String(r.entryId)}
        getRowHref={(r) => `/queue/reviews/${r.entryId}`}
        loading={loading}
        error={loadError ? { message: loadError, onRetry: load } : undefined}
        searchable={(r) => `${r.challengeTitle} ${r.repoName} ${r.roomName ?? ""}`}
        searchPlaceholder={t("searchReviewsPlaceholder")}
        pageSize={20}
        empty={{ icon: ClipboardListIcon, title: t("noReviewsYet") }}
      />
    </div>
  );
}
