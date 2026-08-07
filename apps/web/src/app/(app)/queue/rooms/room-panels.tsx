"use client";

// Queue admin surface for rooms and assignments (H46).

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Spinner } from "@/components/common/spinner";
import { StatusBadge } from "@/components/common/status-badge";
import { UserPicker } from "@/components/common/user-picker";
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
  type QueueSearchResult,
  type RoomAssignments,
  searchTeams,
} from "@/lib/queue";
import type { UserList } from "@/lib/types";
import { type Challenge, textForDisplay } from "../../challenges/shared";

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

export function AssignmentsEditor({
  roomId,
  assignments,
  challengeFallback,
  challenges,
  users,
  onAddChallenge,
  onAddJudge,
  onRemoveJudge,
  canSetChallenge,
}: {
  roomId: number;
  assignments: RoomAssignments | null;
  challengeFallback: number;
  challenges: Challenge[];
  users: UserList["users"];
  onAddChallenge: (challengeId: number) => Promise<void>;
  onAddJudge: (challengeId: number, userId: number) => Promise<void>;
  onRemoveJudge: (challengeId: number, userId: number) => Promise<void>;
  canSetChallenge: boolean;
}) {
  const { t } = useLocale();
  const assignedChallenge = assignments?.challenges[0] ?? null;
  const [challengeId, setChallengeId] = useState("");
  const effectiveChallengeId = assignedChallenge?.challenge_id ?? Number(challengeId || 0);
  const [userId, setUserId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const nextChallengeId = assignments?.challenges[0]?.challenge_id ?? challengeFallback;
    setChallengeId(nextChallengeId ? String(nextChallengeId) : "");
  }, [assignments?.challenges, challengeFallback]);

  const judges = assignments?.judges ?? [];

  // `users` is the already-loaded judge-candidate list (no server-side query
  // param on /judge-candidates), so UserPicker's "search" just filters it
  // client-side by name/email instead of making a new request per keystroke.
  const searchJudgeCandidates = useMemo(
    () => async (query: string) => {
      const q = query.trim().toLowerCase();
      if (!q) return users.slice(0, 20);
      return users
        .filter((user) =>
          [user.name, user.surname, user.email].filter(Boolean).join(" ").toLowerCase().includes(q),
        )
        .slice(0, 20);
    },
    [users],
  );

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor={canSetChallenge ? `challenge-${roomId}` : undefined}>
          {t("roomChallengeLabel")}
        </Label>
        {assignedChallenge ? (
          <p className="text-sm font-medium">{textForDisplay(assignedChallenge.title)}</p>
        ) : (
          <p className="text-muted-foreground text-sm">{t("noChallengeAssigned")}</p>
        )}
        {canSetChallenge && (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Select value={challengeId || undefined} onValueChange={setChallengeId}>
              <SelectTrigger id={`challenge-${roomId}`} className="w-full min-w-0 sm:flex-1">
                <SelectValue placeholder={t("selectChallengePlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {challenges.map((challenge) => (
                  <SelectItem key={challenge.id} value={String(challenge.id)}>
                    {textForDisplay(challenge.title)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              className="shrink-0"
              disabled={busy === "challenge" || !challengeId}
              onClick={async () => {
                setBusy("challenge");
                try {
                  await onAddChallenge(Number(challengeId));
                  toast.success(t("challengeAssigned"));
                } catch (err) {
                  toast.error(err instanceof ApiError ? err.message : t("couldNotAssignChallenge"));
                } finally {
                  setBusy(null);
                }
              }}
            >
              {t("setChallenge")}
            </Button>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor={`judge-user-${roomId}`}>{t("assignJudgeLabel")}</Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <UserPicker
            id={`judge-user-${roomId}`}
            className="w-full min-w-0 sm:flex-1"
            value={userId}
            onChange={setUserId}
            search={searchJudgeCandidates}
            placeholder={t("selectJudgePlaceholder")}
          />
          <Button
            className="shrink-0"
            disabled={busy === "judge" || !userId || !effectiveChallengeId}
            onClick={async () => {
              setBusy("judge");
              try {
                await onAddJudge(effectiveChallengeId, Number(userId));
                toast.success(t("judgeAssigned"));
              } catch (err) {
                toast.error(err instanceof ApiError ? err.message : t("couldNotAssignJudge"));
              } finally {
                setBusy(null);
              }
            }}
          >
            {t("addJudge")}
          </Button>
        </div>
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
                <li
                  key={`${assignment.challenge_id}:${assignment.user_id}`}
                  className="flex items-center justify-between gap-3 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{fullName || assignment.email}</p>
                    {fullName && (
                      <p className="text-muted-foreground truncate text-xs">{assignment.email}</p>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    disabled={busy === `remove-judge-${assignment.user_id}`}
                    onClick={async () => {
                      setBusy(`remove-judge-${assignment.user_id}`);
                      try {
                        await onRemoveJudge(assignment.challenge_id, assignment.user_id);
                        toast.success(t("judgeRemoved"));
                      } catch (err) {
                        toast.error(
                          err instanceof ApiError ? err.message : t("couldNotRemoveJudge"),
                        );
                      } finally {
                        setBusy(null);
                      }
                    }}
                  >
                    {t("remove")}
                  </Button>
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
