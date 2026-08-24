"use client";

// Queue admin surface for rooms and assignments (H46).

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Spinner } from "@/components/common/spinner";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ApiError } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import {
  type ChallengeProgress,
  getChallengeProgress,
  type QueueGroup,
  type QueueSearchResult,
  type RoomAssignments,
  searchTeams,
} from "@/lib/queue";

/**
 * Read-only progress + search for the room's assigned challenge (H46):
 * the sponsor-ownership fallback on `requireChallengeJudgeOrCapability`
 * lets a sponsor rep call these same endpoints the judging workspace uses,
 * without granting them any queue-operating capability.
 */
export function ChallengeResultsPanel({ challengeId }: { challengeId: number }) {
  const { t } = useLocale();
  const [progress, setProgress] = useState<ChallengeProgress | null>(null);
  const [loadingProgress, setLoadingProgress] = useState(true);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<QueueSearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Data-fetch on mount/dependency change pattern.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadingProgress(true);
    getChallengeProgress(challengeId)
      .then((data) => {
        if (!cancelled) setProgress(data);
      })
      .catch((err) => {
        toast.error(err instanceof ApiError ? err.message : t("couldNotLoadChallengeProgress"));
      })
      .finally(() => {
        if (!cancelled) setLoadingProgress(false);
      });
    return () => {
      cancelled = true;
    };
  }, [challengeId, t]);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      // Reset search results when query is cleared.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResults([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      searchTeams(challengeId, q)
        .then((hits) => {
          if (!cancelled) setResults(hits);
        })
        .catch((err) => {
          if (!cancelled) toast.error(err instanceof ApiError ? err.message : t("searchFailed"));
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [challengeId, query, t]);

  const total = progress
    ? progress.waiting +
      progress.called +
      progress.inProgress +
      progress.evaluated +
      progress.disqualified +
      progress.other
    : 0;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-muted-foreground text-xs font-semibold uppercase">
            {t("queueStatsEvaluated")}
          </p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums">
            {loadingProgress ? "…" : progress ? `${progress.evaluated} / ${total}` : "—"}
          </p>
        </div>
        <div>
          <p className="text-muted-foreground text-xs font-semibold uppercase">
            {t("queueStatsAvgTime")}
          </p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums">
            {progress?.avgEvaluationMinutes != null
              ? t("queueStatsMinutes", { count: Math.round(progress.avgEvaluationMinutes) })
              : "—"}
          </p>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`challenge-search-${challengeId}`}>{t("searchTeamsAria")}</Label>
        <Input
          id={`challenge-search-${challengeId}`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("searchProjectPlaceholder")}
        />
        {query.trim() && (
          <ul className="divide-y rounded-md border">
            {searching ? (
              <li className="flex justify-center px-3 py-3">
                <Spinner />
              </li>
            ) : results.length ? (
              results.map((entry) => (
                <li key={entry.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="min-w-0 truncate text-sm font-medium">
                    {entry.repo_name ?? `#${entry.repo_id}`}
                  </span>
                  <StatusBadge tone={entry.has_review ? "success" : "warning"}>
                    {entry.status}
                  </StatusBadge>
                </li>
              ))
            ) : (
              <li className="px-3 py-2 text-muted-foreground text-sm">{t("noTeamsFound")}</li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * Room -> queue group assignment plus the judges that follow from it. The
 * roster itself lives on the enterprise (Enterprises -> Judges), so it is
 * listed here read-only — a room no longer has judges of its own.
 */
export function AssignmentsEditor({
  roomId,
  assignments,
  queueGroupFallback,
  queueGroups,
  onSetQueueGroup,
  onClearQueueGroup,
  canSetQueueGroup,
}: {
  roomId: number;
  assignments: RoomAssignments | null;
  queueGroupFallback: number;
  queueGroups: QueueGroup[];
  onSetQueueGroup: (queueGroupId: number) => Promise<void>;
  /** Leaves the room serving nothing — an enterprise routes its queue to the
   *  rooms it actually wants, not to every room assigned to it. */
  onClearQueueGroup: (queueGroupId: number) => Promise<void>;
  canSetQueueGroup: boolean;
}) {
  const { t } = useLocale();
  const assigned = assignments?.queueGroup ?? null;
  const [queueGroupId, setQueueGroupId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const next = assignments?.queueGroup?.id ?? queueGroupFallback;
    // Auto-derive the selected queue group from async-loaded assignments data.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQueueGroupId(next ? String(next) : "");
  }, [assignments?.queueGroup, queueGroupFallback]);

  const judges = assignments?.judges ?? [];

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor={canSetQueueGroup ? `queue-group-${roomId}` : undefined}>
          {t("roomQueueGroupLabel")}
        </Label>
        {assigned ? (
          <p className="text-sm font-medium">
            {assigned.enterprise_name} · {assigned.display_name}
          </p>
        ) : (
          <p className="text-muted-foreground text-sm">{t("noQueueGroupAssigned")}</p>
        )}
        {canSetQueueGroup && (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Select value={queueGroupId || undefined} onValueChange={setQueueGroupId}>
              <SelectTrigger id={`queue-group-${roomId}`} className="w-full min-w-0 sm:flex-1">
                <SelectValue placeholder={t("selectQueueGroupPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {queueGroups.map((group) => (
                  <SelectItem key={group.id} value={String(group.id)}>
                    {group.enterpriseName} · {group.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              className="shrink-0"
              disabled={busy !== null || !queueGroupId}
              onClick={async () => {
                setBusy("queueGroup");
                try {
                  await onSetQueueGroup(Number(queueGroupId));
                  toast.success(t("queueGroupAssigned"));
                } catch (err) {
                  toast.error(
                    err instanceof ApiError ? err.message : t("couldNotAssignQueueGroup"),
                  );
                } finally {
                  setBusy(null);
                }
              }}
            >
              {t("setQueueGroup")}
            </Button>
            {assigned && (
              <Button
                variant="outline"
                className="shrink-0"
                disabled={busy !== null}
                onClick={async () => {
                  setBusy("clearQueueGroup");
                  try {
                    await onClearQueueGroup(assigned.id);
                    toast.success(t("queueGroupCleared"));
                  } catch (err) {
                    toast.error(
                      err instanceof ApiError ? err.message : t("couldNotAssignQueueGroup"),
                    );
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                {t("clearQueueGroup")}
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">{t("judgesCount", { count: judges.length })}</p>
        {judges.length ? (
          <ul className="divide-y rounded-md border">
            {judges.map((assignment) => {
              const fullName = [assignment.name, assignment.surname]
                .filter(Boolean)
                .join(" ")
                .trim();
              return (
                <li key={assignment.user_id} className="px-3 py-2">
                  <p className="truncate text-sm font-medium">{fullName || assignment.email}</p>
                  {fullName && (
                    <p className="text-muted-foreground truncate text-xs">{assignment.email}</p>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">{t("noJudgesAssigned")}</p>
        )}
      </div>
    </div>
  );
}
