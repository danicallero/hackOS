"use client";

// Queue admin surface for rooms and assignments (H46).

import { useEffect, useMemo, useState } from "react";
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

/** The enterprises owning at least one assignable queue group, de-duplicated. */
export function assignableEnterprises(
  queueGroups: QueueGroup[],
): Array<{ id: number; name: string }> {
  const seen = new Map<number, string>();
  for (const group of queueGroups) {
    if (!seen.has(group.enterprise_id)) seen.set(group.enterprise_id, group.enterprise_name);
  }
  return [...seen].map(([id, name]) => ({ id, name }));
}

/**
 * Room -> queue group assignment plus the judges that follow from it. The
 * roster itself lives on the enterprise (Enterprises -> Judges), so it is
 * listed here read-only — a room no longer has judges of its own.
 *
 * Assignment is two-step, because an enterprise — not a queue group — is what
 * owns a room: pick the enterprise, then pick which of *its* groups the room
 * serves. Both steps resolve against the same `room_queue_groups` link (a
 * group belongs to exactly one enterprise, so the enterprise is derived, never
 * stored twice); the second step is a presentation detail, not new state. An
 * enterprise with a single group — every enterprise today, and the common
 * single-challenge case forever — is auto-filled and shows no group picker.
 */
export function AssignmentsEditor({
  roomId,
  assignments,
  queueGroups,
  onSetQueueGroup,
  canSetQueueGroup,
}: {
  roomId: number;
  assignments: RoomAssignments | null;
  queueGroups: QueueGroup[];
  onSetQueueGroup: (queueGroupId: number) => Promise<void>;
  canSetQueueGroup: boolean;
}) {
  const { t } = useLocale();
  const assigned = assignments?.queueGroup ?? null;
  const [enterpriseId, setEnterpriseId] = useState("");
  const [queueGroupId, setQueueGroupId] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Auto-derive both steps from async-loaded assignments data. An unassigned
    // room starts empty rather than pre-pointing at some other enterprise.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEnterpriseId(assigned ? String(assigned.enterprise_id) : "");
    setQueueGroupId(assigned ? String(assigned.id) : "");
  }, [assigned]);

  const enterprises = useMemo(() => assignableEnterprises(queueGroups), [queueGroups]);
  const enterpriseGroups = useMemo(
    () => queueGroups.filter((group) => String(group.enterprise_id) === enterpriseId),
    [queueGroups, enterpriseId],
  );
  const soleGroup = enterpriseGroups.length === 1 ? enterpriseGroups[0] : null;
  const targetGroupId = soleGroup ? soleGroup.id : Number(queueGroupId) || 0;

  function selectEnterprise(nextEnterpriseId: string) {
    setEnterpriseId(nextEnterpriseId);
    const groups = queueGroups.filter((group) => String(group.enterprise_id) === nextEnterpriseId);
    setQueueGroupId(groups.length === 1 ? String(groups[0].id) : "");
  }

  const judges = assignments?.judges ?? [];

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor={canSetQueueGroup ? `room-enterprise-${roomId}` : undefined}>
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
            <Select value={enterpriseId || undefined} onValueChange={selectEnterprise}>
              <SelectTrigger id={`room-enterprise-${roomId}`} className="w-full min-w-0 sm:flex-1">
                <SelectValue placeholder={t("selectEnterprisePlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {enterprises.map((enterprise) => (
                  <SelectItem key={enterprise.id} value={String(enterprise.id)}>
                    {enterprise.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {enterpriseGroups.length > 1 && (
              <Select value={queueGroupId || undefined} onValueChange={setQueueGroupId}>
                <SelectTrigger
                  id={`queue-group-${roomId}`}
                  aria-label={t("selectQueueGroupPlaceholder")}
                  className="w-full min-w-0 sm:flex-1"
                >
                  <SelectValue placeholder={t("selectQueueGroupPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {enterpriseGroups.map((group) => (
                    <SelectItem key={group.id} value={String(group.id)}>
                      {group.display_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button
              size="lg"
              className="shrink-0"
              disabled={busy || !targetGroupId}
              onClick={async () => {
                setBusy(true);
                try {
                  await onSetQueueGroup(targetGroupId);
                  toast.success(t("queueGroupAssigned"));
                } catch (err) {
                  toast.error(
                    err instanceof ApiError ? err.message : t("couldNotAssignQueueGroup"),
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t("setQueueGroup")}
            </Button>
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
