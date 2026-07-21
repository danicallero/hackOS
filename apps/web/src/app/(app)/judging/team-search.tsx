"use client";

import { ArrowUpToLineIcon, DoorOpenIcon, SearchIcon } from "lucide-react";
import { QueueStatusBadge } from "@/components/common/queue-status-badge";
import { Spinner } from "@/components/common/spinner";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLocale } from "@/lib/i18n";
import type { QueueSearchResult } from "@/lib/queue";
import { entryLabel } from "./helpers";

/**
 * H37 search-as-you-type. Each hit offers the two "add" actions from the story:
 * move to the top of the queue, or drop straight into the waiting room. Both
 * only ever MOVE the existing queue entry (never create a second evaluation).
 */
export function TeamSearch({
  query,
  results,
  searching,
  trimmed,
  busy,
  canOperate,
  canJudge,
  onQuery,
  onAddTop,
  onAddWaiting,
  onReEnter,
  onBringIn,
  onOpenReview,
}: {
  query: string;
  results: QueueSearchResult[];
  searching: boolean;
  trimmed: string;
  busy: string | null;
  canOperate: boolean;
  canJudge: boolean;
  onQuery: (value: string) => void;
  onAddTop: (entry: QueueSearchResult) => void;
  onAddWaiting: (entry: QueueSearchResult) => void;
  onReEnter: (entry: QueueSearchResult, position: "top" | "bottom") => void;
  onBringIn: (entry: QueueSearchResult) => void;
  onOpenReview: (entry: QueueSearchResult) => void;
}) {
  const { t } = useLocale();
  return (
    <div className="bg-muted/30 space-y-3 rounded-md border p-3">
      <div className="relative">
        <Label htmlFor="judging-team-search" className="sr-only">
          {t("searchTeamsAria")}
        </Label>
        <SearchIcon className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input
          id="judging-team-search"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder={t("searchProjectPlaceholder")}
          className="pl-9"
        />
      </div>
      {!trimmed ? (
        <p className="text-muted-foreground py-2 text-center text-xs">{t("startTypingFindTeam")}</p>
      ) : searching && results.length === 0 ? (
        <div className="flex justify-center py-4">
          <Spinner />
        </div>
      ) : results.length === 0 ? (
        <p className="text-muted-foreground py-2 text-center text-xs">{t("noTeamsFound")}</p>
      ) : (
        <ul className="max-h-72 space-y-2 overflow-y-auto pr-1">
          {results.map((entry) => (
            <li key={entry.id} className="bg-background rounded-md border p-3">
              <p className="truncate text-sm font-medium">{entryLabel(entry, t)}</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <QueueStatusBadge status={entry.status} />
                {entry.has_review && (
                  <StatusBadge tone={entry.review_status === "submitted" ? "success" : "warning"}>
                    {entry.review_status ?? t("reviewFallback")}
                  </StatusBadge>
                )}
              </div>
              {entry.blocked_by_room_name ? (
                <p
                  className="mt-2 text-pretty text-xs text-amber-700 dark:text-amber-300"
                  role="status"
                >
                  {t("teamBusyInOtherRoom", { room: entry.blocked_by_room_name })}
                </p>
              ) : null}
              {entry.has_review ? (
                <Button
                  size="sm"
                  className="mt-2 w-full"
                  disabled={busy != null || !canJudge}
                  onClick={() => onOpenReview(entry)}
                >
                  {t("openExistingEvaluation")}
                </Button>
              ) : ["completed", "cancelled", "disqualified"].includes(entry.status) ? (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy != null || !canOperate || Boolean(entry.blocked_by_room_name)}
                    onClick={() => onReEnter(entry, "top")}
                  >
                    {t("reenterTop")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy != null || !canOperate || Boolean(entry.blocked_by_room_name)}
                    onClick={() => onReEnter(entry, "bottom")}
                  >
                    {t("reenterBottom")}
                  </Button>
                </div>
              ) : (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy != null || !canOperate || Boolean(entry.blocked_by_room_name)}
                    onClick={() => onAddTop(entry)}
                  >
                    <ArrowUpToLineIcon className="size-4" />
                    {t("topOfQueue")}
                  </Button>
                  <Button
                    size="sm"
                    disabled={busy != null || !canOperate || Boolean(entry.blocked_by_room_name)}
                    onClick={() => onAddWaiting(entry)}
                  >
                    <DoorOpenIcon className="size-4" />
                    {t("waitingRoomButton")}
                  </Button>
                  <Button
                    size="sm"
                    className="col-span-2"
                    disabled={busy != null || !canJudge || Boolean(entry.blocked_by_room_name)}
                    onClick={() => onBringIn(entry)}
                  >
                    <DoorOpenIcon className="size-4" />
                    {t("bringInDirectly")}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
