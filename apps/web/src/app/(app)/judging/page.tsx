"use client";

// Queue and judging panel (H29-H40). The layout follows the older judging
// panel's room header + left queue + right presentation/review structure, but
// uses this app's shared API wrappers, cards, tabs and form controls.

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS } from "@hackos/shared/events";
import {
  ChevronDownIcon,
  DoorOpenIcon,
  DownloadIcon,
  LockIcon,
  PauseIcon,
  PlayIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AccessDenied } from "@/components/common/access-denied";
import { EmptyState } from "@/components/common/empty-state";
import { Spinner } from "@/components/common/spinner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLiveQuery } from "@/hooks/use-event-source";
import { api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { workspaceAccess } from "@/lib/judging-workspace";
import {
  type ChallengeProgress,
  entryAction,
  exportUrls,
  getChallengeProgress,
  getRoomPace,
  getRoomView,
  listRooms,
  pauseRoom,
  type QueueEntry,
  type QueueSearchResult,
  type Room,
  type RoomPace,
  type RoomView,
  resumeRoom,
  searchTeams,
} from "@/lib/queue";
import { useSessionContext } from "@/lib/session";
import type { Challenge } from "../challenges/shared";

import { ConfirmAction } from "./confirm-action";
import { challengeName, errorMessage, exportHref } from "./helpers";
import { PresentationPanel } from "./presentation-panel";
import { QueuePanel } from "./queue-panel";
import { ReviewForm } from "./review-form";

export default function QueuePage() {
  const { can, me } = useSessionContext();
  const { t } = useLocale();
  const { canOperate, canJudge, canAdmin, canExport, canUse } = workspaceAccess({
    operate: can(CAPABILITIES.QUEUE_OPERATE),
    judge: can(CAPABILITIES.JUDGE_PANEL),
    admin: can(CAPABILITIES.QUEUE_ADMIN),
    exportData: can(CAPABILITIES.JUDGING_EXPORT),
    isRoomJudge: me?.isRoomJudge ?? false,
  });

  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(true);
  const [roomId, setRoomId] = useState<number | null>(null);
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<QueueSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedReviewEntry, setSelectedReviewEntry] = useState<QueueEntry | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const activeRoomId = roomId ?? rooms[0]?.id ?? null;

  const roomView = useLiveQuery<RoomView>(
    () => (activeRoomId ? getRoomView(activeRoomId) : Promise.resolve(null as never)),
    "/api/queue/stream",
    [EVENTS.QUEUE_ENTRY_CHANGED, EVENTS.QUEUE_ROOM_CHANGED, EVENTS.QUEUE_NOTIFY_ENTER],
    { enabled: canUse && activeRoomId != null, queryKey: [activeRoomId] },
  );

  const pace = useLiveQuery<RoomPace>(
    () => (activeRoomId ? getRoomPace(activeRoomId) : Promise.resolve(null as never)),
    "/api/queue/stream",
    [EVENTS.QUEUE_ENTRY_CHANGED, EVENTS.QUEUE_ROOM_CHANGED],
    { enabled: canUse && activeRoomId != null, queryKey: [activeRoomId] },
  );

  // The room judges a single challenge (read-only label in the panel); fall
  // back to whatever a live entry reports so a freshly seeded room still works.
  const effectiveChallengeId =
    roomView.data?.challenge?.id ??
    roomView.data?.active?.challenge_id ??
    roomView.data?.called[0]?.challenge_id ??
    roomView.data?.next[0]?.challenge_id ??
    challenges[0]?.id ??
    null;

  const progress = useLiveQuery<ChallengeProgress>(
    () =>
      effectiveChallengeId
        ? getChallengeProgress(effectiveChallengeId)
        : Promise.resolve(null as never),
    "/api/queue/stream",
    [EVENTS.QUEUE_ENTRY_CHANGED, EVENTS.QUEUE_ROOM_CHANGED],
    { enabled: canUse && effectiveChallengeId != null, queryKey: [effectiveChallengeId] },
  );

  const activeChallenge = useMemo(
    () => challenges.find((c) => c.id === effectiveChallengeId) ?? null,
    [challenges, effectiveChallengeId],
  );

  const loadRooms = useCallback(async () => {
    if (!canUse) {
      setRoomsLoading(false);
      return;
    }
    setRoomsLoading(true);
    try {
      const [roomRows, challengeRows] = await Promise.all([
        listRooms(),
        api.get<{ challenges: Challenge[] }>("/api/challenges"),
      ]);
      setRooms(roomRows);
      setChallenges(challengeRows.challenges);
      setRoomId((current) => current ?? roomRows[0]?.id ?? null);
    } catch (err) {
      const message = errorMessage(err, t("couldNotLoadQueueSetup"));
      setActionError(message);
      toast.error(message);
    } finally {
      setRoomsLoading(false);
    }
  }, [canUse, t]);

  useEffect(() => {
    void loadRooms();
  }, [loadRooms]);

  const refreshLive = useCallback(async () => {
    await Promise.all([roomView.refetch(), pace.refetch(), progress.refetch()]);
  }, [roomView, pace, progress]);

  const mutate = useCallback(
    async (key: string, action: () => Promise<unknown>, success: string) => {
      setBusy(key);
      setActionError(null);
      try {
        await action();
        toast.success(success);
        await refreshLive();
      } catch (err) {
        const message = errorMessage(err, t("queueActionFailed"));
        setActionError(message);
        toast.error(message);
      } finally {
        setBusy(null);
      }
    },
    [refreshLive, t],
  );

  // Shared by the queue panel's per-entry actions and the empty-room
  // "call next" / "bring in next" shortcuts on the presentation panel.
  const handleManualCall = useCallback(
    (entry: QueueEntry, targetStatus: "called" | "in_room") =>
      activeRoomId &&
      mutate(
        `manual-${entry.id}`,
        () =>
          entryAction(
            entry.id,
            "manual-call",
            { targetStatus, roomId: activeRoomId, reason: "Manual queue selection" },
            crypto.randomUUID(),
          ),
        targetStatus === "in_room" ? t("teamBroughtIn") : t("teamCalled"),
      ),
    [activeRoomId, mutate, t],
  );

  // H37 search-as-you-type: debounce the query and refresh results as the
  // operator types. An empty query clears the list.
  // biome-ignore lint/correctness/useExhaustiveDependencies: roomView.data changes after each SSE-backed room refresh and intentionally refreshes open search eligibility.
  useEffect(() => {
    const term = search.trim();
    if (!effectiveChallengeId || !term) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const handle = window.setTimeout(async () => {
      try {
        const hits = await searchTeams(effectiveChallengeId, term);
        if (!cancelled) setSearchResults(hits);
      } catch (err) {
        if (!cancelled) {
          const message = errorMessage(err, t("searchFailed"));
          setActionError(message);
          toast.error(message);
        }
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [effectiveChallengeId, roomView.data, search, t]);

  if (!canUse) {
    return <AccessDenied ask={t("judgingAccessDeniedDesc")} />;
  }

  const view = roomView.data;
  const active = view?.active ?? null;
  const state = view?.state ?? null;
  const isPaused = state?.is_paused ?? view?.room.status === "paused";
  const challengeLabel =
    view?.challenge?.title ?? (activeChallenge ? challengeName(t, activeChallenge) : "—");

  return (
    // App-like layout: the room selector pins to the top, the queue panel stays
    // put on the left, and only the right column (project + scoring) scrolls.
    // At xl we clamp the whole page to the viewport (100dvh minus the app chrome:
    // 3.5rem header + 2rem+2rem main py-8) so the outer page never scrolls.
    <div className="flex flex-col gap-5 xl:h-[calc(100dvh-7.5rem)]" data-wide>
      <Card className="gap-0 p-5">
        {/* Fluid header (H29, issue #61): the two field columns grow/shrink and
            the action cluster drops to its own row under tight widths (tiling
            WMs, tablet/mobile) instead of overflowing the card. No fixed track
            widths — flex-basis + min-width + flex-wrap handle the reflow. */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[11rem] flex-1 space-y-2">
            <Label htmlFor="queue-room">{t("roomLabel")}</Label>
            <Select
              value={activeRoomId ? String(activeRoomId) : ""}
              onValueChange={(value) => {
                setRoomId(Number(value));
                setSelectedReviewEntry(null);
              }}
              disabled={roomsLoading || rooms.length === 0}
            >
              <SelectTrigger id="queue-room" className="w-full">
                <SelectValue placeholder={t("selectRoomPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {rooms.map((room) => (
                  <SelectItem key={room.id} value={String(room.id)}>
                    {room.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* A room judges exactly one challenge — informational, read-only.
              Change it from the room admin surface, not here. */}
          <div className="min-w-[11rem] flex-[1.2] space-y-2">
            <Label>{t("challengeLabel")}</Label>
            <div className="border-input bg-muted/40 text-muted-foreground flex h-9 w-full min-w-0 items-center gap-2 rounded-md border px-3 text-sm">
              <LockIcon className="size-3.5 shrink-0" />
              <span className="text-foreground truncate font-medium">{challengeLabel}</span>
            </div>
          </div>

          <div className="flex flex-1 flex-wrap items-end gap-2 sm:justify-end">
            {isPaused ? (
              <Button
                disabled={!activeRoomId || busy === "pause" || (!canOperate && !canJudge)}
                onClick={() =>
                  activeRoomId &&
                  mutate(
                    "pause",
                    () => resumeRoom(activeRoomId, crypto.randomUUID()),
                    t("roomResumed"),
                  )
                }
              >
                <PlayIcon className="size-4" />
                {t("resume")}
              </Button>
            ) : (
              <ConfirmAction
                title={t("pauseRoomTitle")}
                description={t("pauseRoomDescription")}
                confirmLabel={t("pause")}
                onConfirm={() =>
                  activeRoomId &&
                  mutate(
                    "pause",
                    () => pauseRoom(activeRoomId, crypto.randomUUID()),
                    t("roomPaused"),
                  )
                }
                trigger={
                  <Button
                    variant="outline"
                    disabled={!activeRoomId || busy === "pause" || (!canOperate && !canJudge)}
                  >
                    <PauseIcon className="size-4" />
                    {t("pause")}
                  </Button>
                }
              />
            )}

            {canExport && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" disabled={!effectiveChallengeId}>
                    <DownloadIcon className="size-4" />
                    {t("exportData")}
                    <ChevronDownIcon className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                {effectiveChallengeId && (
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuItem asChild>
                      <a href={exportHref(exportUrls(effectiveChallengeId).queue)}>
                        <DownloadIcon className="size-4" />
                        {t("queueExportLabel")}
                      </a>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <a href={exportHref(exportUrls(effectiveChallengeId).evaluations)}>
                        <DownloadIcon className="size-4" />
                        {t("evaluationsExport")}
                      </a>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                )}
              </DropdownMenu>
            )}
          </div>
        </div>
      </Card>

      {actionError && (
        <div
          role="alert"
          className="border-destructive/40 bg-destructive/5 text-destructive flex items-start justify-between gap-3 rounded-md border px-4 py-3 text-sm"
        >
          <span>{actionError}</span>
          <button
            type="button"
            aria-label={t("dismiss")}
            onClick={() => setActionError(null)}
            className="shrink-0 opacity-70 transition-opacity hover:opacity-100"
          >
            <XIcon className="size-4" />
          </button>
        </div>
      )}

      {roomsLoading || roomView.loading ? (
        <div className="flex min-h-[360px] flex-1 items-center justify-center">
          <Spinner />
        </div>
      ) : !view ? (
        <div className="flex flex-1 items-center justify-center">
          <EmptyState
            icon={DoorOpenIcon}
            title={roomView.error ? t("couldNotLoadQueueSetup") : t("noRoomSelected")}
            description={
              roomView.error
                ? errorMessage(roomView.error, t("couldNotLoadQueueSetup"))
                : t("noRoomSelectedDesc")
            }
          />
        </div>
      ) : (
        // Two-column region fills the remaining height. Left column is pinned and
        // scrolls internally if the queue is long; right column is the scroll area.
        <div className="grid gap-5 xl:min-h-0 xl:flex-1 xl:grid-cols-[360px_minmax(0,1fr)]">
          <div className="xl:min-h-0 xl:overflow-y-auto">
            <QueuePanel
              view={view}
              progress={progress.data}
              pace={pace.data}
              canOperate={canOperate}
              canJudge={canJudge}
              canAdmin={canAdmin}
              busy={busy}
              query={search}
              results={searchResults}
              searching={searching}
              searchDisabled={!effectiveChallengeId}
              onQuery={setSearch}
              onManualCall={handleManualCall}
              onEntryAction={(entry, action, body, label) =>
                mutate(
                  `${action}-${entry.id}`,
                  () => entryAction(entry.id, action, body, crypto.randomUUID()),
                  label,
                )
              }
              onAddTop={(entry) =>
                mutate(
                  `move-top-${entry.id}`,
                  () =>
                    entryAction(
                      entry.id,
                      "move-top",
                      { reason: "Search: moved to top of queue" },
                      crypto.randomUUID(),
                    ),
                  t("teamMovedTop"),
                )
              }
              onAddWaiting={(entry) =>
                activeRoomId &&
                mutate(
                  `add-waiting-${entry.id}`,
                  () =>
                    entryAction(
                      entry.id,
                      "manual-call",
                      {
                        targetStatus: "called",
                        roomId: activeRoomId,
                        reason: "Search: to waiting room",
                      },
                      crypto.randomUUID(),
                    ),
                  t("teamAddedWaiting"),
                )
              }
              onReEnter={(entry, position) =>
                mutate(
                  `re-enter-${entry.id}-${position}`,
                  () =>
                    entryAction(
                      entry.id,
                      "re-enter",
                      { position, reason: "Recovered from manual search" },
                      crypto.randomUUID(),
                    ),
                  t("teamReentered"),
                )
              }
              onOpenReview={setSelectedReviewEntry}
            />
          </div>

          {/* Main column: evaluated project card, then scoring / questions
              flowing directly below it. This column owns the page scroll. */}
          <div className="space-y-5 xl:min-h-0 xl:overflow-y-auto">
            <PresentationPanel
              entry={active}
              challenge={activeChallenge}
              pace={pace.data}
              waitingRoomCount={view.called.length}
              nextWaitingEntry={view.next[0] ?? null}
              firstCalledEntry={view.called[0] ?? null}
              canJudge={canJudge}
              canOperate={canOperate}
              busy={busy}
              onEntryAction={(entry, action, body, label) =>
                mutate(
                  `${action}-${entry.id}`,
                  () => entryAction(entry.id, action, body, crypto.randomUUID()),
                  label,
                )
              }
              onManualCall={handleManualCall}
            />

            <ReviewForm
              entry={selectedReviewEntry ?? active}
              challenge={activeChallenge}
              roomId={activeRoomId}
              canJudge={
                canJudge && (active?.status === "presenting" || selectedReviewEntry != null)
              }
              onCloseExisting={selectedReviewEntry ? () => setSelectedReviewEntry(null) : undefined}
            />
          </div>
        </div>
      )}
    </div>
  );
}
