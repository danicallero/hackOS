"use client";

import {
  BanIcon,
  ChevronDownIcon,
  DoorOpenIcon,
  ListEndIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Surface } from "@/components/ui/surface";
import { ApiError } from "@/lib/api";
import { type Translate, useLocale } from "@/lib/i18n";
import {
  entryAction,
  getRepoChallenges,
  moveQueueEntryToPosition,
  type QueueEntry,
  type RepoChallenge,
  type RoomView,
} from "@/lib/queue";

type TeamCandidate = { repoId: number; repoName: string };

const statusPriority: Record<string, number> = {
  presenting: 0,
  in_room: 1,
  called: 2,
  waiting: 3,
  completed: 4,
  disqualified: 5,
};

function entriesForRoom(room: RoomView): QueueEntry[] {
  return [room.active, ...room.called, ...room.next].filter(
    (entry): entry is QueueEntry => entry !== null,
  );
}

function queueMemberships(entries: RepoChallenge[]): RepoChallenge[] {
  const byQueue = new Map<string, RepoChallenge>();
  for (const entry of entries) {
    const key = `queue:${entry.queue_group_id ?? entry.id}`;
    const current = byQueue.get(key);
    if (!current) {
      byQueue.set(key, entry);
      continue;
    }
    const currentPriority = statusPriority[current.status] ?? 99;
    const entryPriority = statusPriority[entry.status] ?? 99;
    if (
      entryPriority < currentPriority ||
      (entryPriority === currentPriority &&
        (entry.position ?? Number.MAX_SAFE_INTEGER) < (current.position ?? Number.MAX_SAFE_INTEGER))
    ) {
      byQueue.set(key, entry);
    }
  }
  return [...byQueue.values()].sort(
    (a, b) =>
      (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER) ||
      (a.queue_name ?? a.title).localeCompare(b.queue_name ?? b.title),
  );
}

function etaLabel(entry: RepoChallenge, t: Translate): string | null {
  if (entry.status !== "waiting") return null;
  if (entry.eta_minutes == null) return t("queueTeamNoEstimate");
  return t("queueTeamApproxCall", { minutes: entry.eta_minutes });
}

function queueStatusLabel(status: string, t: Translate): string {
  switch (status) {
    case "waiting":
      return t("queueStatusWaiting");
    case "called":
      return t("queueStatusCalled");
    case "in_room":
      return t("queueStatusInRoom");
    case "presenting":
      return t("queueStatusPresenting");
    case "completed":
      return t("queueStatusCompleted");
    case "disqualified":
      return t("queueStatusDisqualified");
    default:
      return status;
  }
}

export function TeamQueueSearch({
  rooms,
  canOperate,
  canAdmin,
  onChanged,
  onClose,
}: {
  rooms: RoomView[];
  canOperate: boolean;
  canAdmin: boolean;
  onChanged: () => void;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const [query, setQuery] = useState("");
  const [selectedRepoId, setSelectedRepoId] = useState<number | null>(null);
  const [memberships, setMemberships] = useState<RepoChallenge[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyEntryId, setBusyEntryId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const candidates = useMemo(() => {
    const byRepo = new Map<number, TeamCandidate>();
    for (const room of rooms) {
      for (const entry of entriesForRoom(room)) {
        if (!byRepo.has(entry.repo_id)) {
          byRepo.set(entry.repo_id, {
            repoId: entry.repo_id,
            repoName: entry.repo_name ?? t("repoNumber", { id: entry.repo_id }),
          });
        }
      }
    }
    return [...byRepo.values()].sort((a, b) => a.repoName.localeCompare(b.repoName));
  }, [rooms, t]);

  const matchingTeams = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return [];
    return candidates.filter((candidate) =>
      candidate.repoName.toLocaleLowerCase().includes(needle),
    );
  }, [candidates, query]);

  const loadMemberships = useCallback(
    async (repoId: number) => {
      setLoading(true);
      setError(null);
      try {
        setMemberships(queueMemberships(await getRepoChallenges(repoId)));
      } catch (err) {
        setMemberships([]);
        setError(err instanceof ApiError ? err.message : t("queueTeamSearchFailed"));
      } finally {
        setLoading(false);
      }
    },
    [t],
  );

  useEffect(() => {
    if (selectedRepoId === null) return;
    void loadMemberships(selectedRepoId);
  }, [loadMemberships, selectedRepoId]);

  const selectTeam = (candidate: TeamCandidate) => {
    setSelectedRepoId(candidate.repoId);
    setQuery(candidate.repoName);
  };

  const runAction = async (
    entry: RepoChallenge,
    action: "manual-call" | "move-top" | "move-end" | "disqualify",
    roomId?: number,
  ) => {
    if (busyEntryId !== null) return;
    if (action === "disqualify" && !canAdmin) return;
    if (action !== "disqualify" && !canOperate) return;
    if (action === "manual-call" && roomId == null) return;

    setBusyEntryId(entry.entry_id);
    try {
      if (action === "manual-call") {
        await entryAction(
          entry.entry_id,
          "manual-call",
          {
            targetStatus: "called",
            roomId,
            reason: "Queue operations: manually added to waiting room",
          },
          crypto.randomUUID(),
        );
        toast.success(t("teamAddedWaiting"));
      } else if (action === "move-top") {
        await entryAction(
          entry.entry_id,
          "move-top",
          { reason: "Queue operations: moved team to top from team search" },
          crypto.randomUUID(),
        );
        toast.success(t("teamMovedTop"));
      } else if (action === "move-end") {
        if (entry.status === "waiting") {
          await moveQueueEntryToPosition(
            entry.entry_id,
            999_999,
            "Queue operations: moved team to end from team search",
            crypto.randomUUID(),
          );
        } else {
          await entryAction(
            entry.entry_id,
            "requeue",
            {
              position: "bottom",
              reason: "Queue operations: moved team to end from team search",
            },
            crypto.randomUUID(),
          );
        }
        toast.success(t("teamRequeued"));
      } else {
        await entryAction(
          entry.entry_id,
          "disqualify",
          { reason: "Queue operations: disqualified from team search" },
          crypto.randomUUID(),
        );
        toast.success(t("queueTeamDisqualified"));
      }
      await loadMemberships(entry.repo_id);
      onChanged();
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? err.message
          : action === "disqualify"
            ? t("queueTeamDisqualifyFailed")
            : t("queueTeamMoveFailed"),
      );
    } finally {
      setBusyEntryId(null);
    }
  };

  const selectedTeam =
    selectedRepoId === null
      ? null
      : (candidates.find((candidate) => candidate.repoId === selectedRepoId) ?? null);

  return (
    <Surface padding="compact" className="space-y-4" aria-label={t("queueTeamSearch")}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">{t("queueTeamSearch")}</h2>
          <p className="text-muted-foreground mt-1 text-sm">{t("queueTeamSearchDescription")}</p>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label={t("queueCloseSearch")} onClick={onClose}>
          <XIcon className="size-4" />
        </Button>
      </div>

      <div>
        <Label htmlFor="queue-team-search-input" className="sr-only">
          {t("queueTeamSearch")}
        </Label>
        <div className="relative">
          <SearchIcon
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
            aria-hidden="true"
          />
          <Input
            id="queue-team-search-input"
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelectedRepoId(null);
              setMemberships([]);
              setError(null);
            }}
            placeholder={t("queueTeamSearchPlaceholder")}
            className="pl-8"
          />
        </div>
      </div>

      {selectedTeam === null && query.trim() && (
        <div className="space-y-1" aria-live="polite">
          {matchingTeams.length > 0 ? (
            matchingTeams.slice(0, 8).map((candidate) => (
              <button
                key={candidate.repoId}
                type="button"
                className="hover:bg-muted focus-visible:bg-muted flex w-full min-w-0 items-center rounded-control px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                title={candidate.repoName}
                onClick={() => selectTeam(candidate)}
              >
                <span className="min-w-0 truncate">{candidate.repoName}</span>
              </button>
            ))
          ) : (
            <p className="text-muted-foreground px-3 py-2 text-sm">
              {t("queueTeamSearchNoMatches")}
            </p>
          )}
        </div>
      )}

      {selectedTeam && (
        <div className="space-y-3" aria-live="polite">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="min-w-0 truncate text-sm font-semibold" title={selectedTeam.repoName}>
              {selectedTeam.repoName}
            </h3>
            {!loading && (
              <span className="text-muted-foreground text-xs">{t("queueTeamQueues")}</span>
            )}
          </div>
          {loading ? (
            <p className="text-muted-foreground text-sm">{t("loading")}</p>
          ) : error ? (
            <p className="text-destructive text-sm">{error}</p>
          ) : memberships.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("queueTeamNoQueues")}</p>
          ) : (
            <div className="divide-border divide-y rounded-control border">
              {memberships.map((entry) => {
                const eta = etaLabel(entry, t);
                const calledInAnotherRoom = memberships.some(
                  (candidate) =>
                    candidate.entry_id !== entry.entry_id &&
                    ["called", "in_room", "presenting"].includes(candidate.status),
                );
                const beingEvaluatedInAnotherRoom = memberships.some(
                  (candidate) =>
                    candidate.entry_id !== entry.entry_id &&
                    ["in_room", "presenting"].includes(candidate.status),
                );
                return (
                  <div key={entry.entry_id} className="flex items-center gap-3 px-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p
                        className="min-w-0 truncate text-sm font-medium"
                        title={entry.queue_name ?? entry.title}
                      >
                        {entry.queue_name ?? entry.title}
                      </p>
                      {entry.queue_name && entry.queue_name !== entry.title && (
                        <p className="text-muted-foreground truncate text-xs">{entry.title}</p>
                      )}
                      <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                        {entry.position != null && (
                          <span>{t("queueTeamPosition", { position: entry.position })}</span>
                        )}
                        {eta && <span>{eta}</span>}
                        <span>{queueStatusLabel(entry.status, t)}</span>
                      </div>
                    </div>
                    <TeamQueueActions
                      entry={entry}
                      canOperate={canOperate}
                      canAdmin={canAdmin}
                      calledInAnotherRoom={calledInAnotherRoom}
                      beingEvaluatedInAnotherRoom={beingEvaluatedInAnotherRoom}
                      busy={busyEntryId === entry.entry_id}
                      onAction={(action, roomId) => void runAction(entry, action, roomId)}
                      t={t}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </Surface>
  );
}

function TeamQueueActions({
  entry,
  canOperate,
  canAdmin,
  calledInAnotherRoom,
  beingEvaluatedInAnotherRoom,
  busy,
  onAction,
  t,
}: {
  entry: RepoChallenge;
  canOperate: boolean;
  canAdmin: boolean;
  calledInAnotherRoom: boolean;
  beingEvaluatedInAnotherRoom: boolean;
  busy: boolean;
  onAction: (
    action: "manual-call" | "move-top" | "move-end" | "disqualify",
    roomId?: number,
  ) => void;
  t: Translate;
}) {
  const showMove =
    canOperate && entry.position != null && ["waiting", "called"].includes(entry.status);
  const canMove = showMove && !beingEvaluatedInAnotherRoom;
  const showManualCall = canOperate && entry.status === "waiting" && entry.judging_rooms.length > 0;
  const canManualCall = showManualCall && !calledInAnotherRoom;
  const canDisqualify = canAdmin && !["completed", "disqualified"].includes(entry.status);
  const busyReason = t("queueActionBlockedBusy");
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
      {showManualCall && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="xs"
              disabled={busy || !canManualCall}
              title={canManualCall ? t("queueManualAdd") : busyReason}
              aria-label={t("queueManualAdd")}
            >
              <DoorOpenIcon className="size-3.5" />
              {t("queueManualAdd")}
              <ChevronDownIcon className="size-3.5" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {entry.judging_rooms.map((room) => (
              <DropdownMenuItem
                key={room.id}
                title={t("queueManualAddToRoom", { room: room.name })}
                onSelect={() => onAction("manual-call", room.id)}
              >
                <DoorOpenIcon className="size-4" />
                {room.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {showMove && (
        <>
          <Button
            variant="ghost"
            size="xs"
            disabled={busy || !canMove}
            title={canMove ? t("queuePrioritize") : busyReason}
            onClick={() => onAction("move-top")}
          >
            <ListEndIcon className="size-3.5 rotate-180" />
            {t("queuePrioritize")}
          </Button>
          <Button
            variant="ghost"
            size="xs"
            disabled={busy || !canMove}
            title={canMove ? t("queueMoveToEnd") : busyReason}
            onClick={() => onAction("move-end")}
          >
            <ListEndIcon className="size-3.5" />
            {t("queueMoveToEnd")}
          </Button>
        </>
      )}
      {canDisqualify && (
        <Button
          variant="ghost"
          size="xs"
          disabled={busy}
          className="text-destructive hover:text-destructive"
          onClick={() => onAction("disqualify")}
        >
          <BanIcon className="size-3.5" />
          {t("queueDisqualify")}
        </Button>
      )}
    </div>
  );
}
