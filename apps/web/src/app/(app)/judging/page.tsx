"use client";

// Queue and judging panel (H29-H40). The layout follows the older judging
// panel's room header + left queue + right presentation/review structure, but
// uses this app's shared API wrappers, cards, tabs and form controls.

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS, REALTIME_SCOPES } from "@hackos/shared/events";
import { DoorOpenIcon } from "@phosphor-icons/react/dist/csr/DoorOpen";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessDenied } from "@/components/common/access-denied";
import { EmptyState } from "@/components/common/empty-state";
import { Spinner } from "@/components/common/spinner";
import { useLiveQuery } from "@/hooks/use-event-source";
import { ApiError, api } from "@/lib/api";
import { type Translate, useLocale } from "@/lib/i18n";
import { workspaceAccess } from "@/lib/judging-workspace";
import {
  type ChallengeProgress,
  entryAction,
  getChallengeProgress,
  getRoomPace,
  getRoomView,
  listRooms,
  moveQueueEntryToPosition,
  pauseRoom,
  type QueueEntry,
  type QueueSearchResult,
  type Room,
  type RoomPace,
  type RoomView,
  resumeRoom,
  searchTeams,
} from "@/lib/queue";
import { invalidateServerState } from "@/lib/server-state";
import { useSessionContext } from "@/lib/session";
import { toast } from "@/lib/toast";
import { confirmDiscardUnsavedChanges } from "@/lib/use-unsaved-changes-guard";
import { cn } from "@/lib/utils";
import type { Challenge } from "../challenges/shared";

import { errorMessage, queueErrorToastContent } from "./helpers";
import { JudgingTopBar } from "./judging-top-bar";
import { PresentationPanel } from "./presentation-panel";
import { QueuePanel } from "./queue-panel";
import { ReviewForm } from "./review-form";
import { useExpandedTransition, useFocusPreference, useReviewWindow } from "./use-judging-layout";

function showQueueError(t: Translate, err: unknown, fallbackTitle: string) {
  const copy = queueErrorToastContent(
    err,
    t,
    fallbackTitle,
    t("couldNotCallTeam"),
    t("teamCallBlockedDescription"),
  );
  toast.error(copy.description ?? copy.title, {
    compactTitle: t("judging"),
    ...(copy.isBusyTeam ? { autopilot: { expand: 0, collapse: 0 } } : {}),
  });
  return copy.message;
}

export default function QueuePage() {
  const { can, me } = useSessionContext();
  const { t } = useLocale();
  const { canOperate, canJudge, canAdmin, canExport, canUse } = workspaceAccess({
    operate: can(CAPABILITIES.QUEUE_OPERATE),
    judge: can(CAPABILITIES.JUDGE_PANEL),
    admin: can(CAPABILITIES.QUEUE_ADMIN),
    exportData: can(CAPABILITIES.JUDGING_EXPORT),
    isEnterpriseJudge: me?.isEnterpriseJudge ?? false,
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
  // #1014: the review form saves pending edits when it leaves an entry; it
  // only reports edits it cannot save (failed save, conflict, offline), and
  // switching away from those asks first.
  const [reviewEditsAtRisk, setReviewEditsAtRisk] = useState(false);
  const { focusMode, changeFocusMode } = useFocusPreference();
  const selectReviewEntry = (entry: QueueEntry | null) => {
    if (!confirmDiscardUnsavedChanges(reviewEditsAtRisk, t)) return false;
    setSelectedReviewEntry(entry);
    return true;
  };
  const [actionError, setActionError] = useState<string | null>(null);

  const activeRoomId = roomId ?? rooms[0]?.id ?? null;

  const roomView = useLiveQuery<RoomView>(
    (signal) => (activeRoomId ? getRoomView(activeRoomId, signal) : Promise.resolve(null as never)),
    REALTIME_SCOPES.QUEUE,
    // Pump top-ups (e.g. after resume) call teams with QUEUE_TEAM_CALLED only.
    [
      EVENTS.QUEUE_ENTRY_CHANGED,
      EVENTS.QUEUE_ROOM_CHANGED,
      EVENTS.QUEUE_NOTIFY_ENTER,
      EVENTS.QUEUE_TEAM_CALLED,
    ],
    {
      enabled: canUse && activeRoomId != null,
      queryKey: [activeRoomId],
      resourceKey: ["judging", "room-view", activeRoomId],
      identityKey: me?.id ?? null,
    },
  );

  // The room judges a single challenge (read-only label in the panel); fall
  // back to whatever a live entry reports so a freshly seeded room still works.
  const effectiveChallengeId =
    roomView.data?.active?.challenge_id ??
    roomView.data?.challenge?.id ??
    roomView.data?.called[0]?.challenge_id ??
    roomView.data?.next[0]?.challenge_id ??
    challenges[0]?.id ??
    null;

  const pace = useLiveQuery<RoomPace>(
    (signal) =>
      activeRoomId
        ? getRoomPace(activeRoomId, signal, effectiveChallengeId)
        : Promise.resolve(null as never),
    REALTIME_SCOPES.QUEUE,
    [EVENTS.QUEUE_ENTRY_CHANGED, EVENTS.QUEUE_ROOM_CHANGED, EVENTS.QUEUE_TEAM_CALLED],
    {
      enabled: canUse && activeRoomId != null,
      queryKey: [activeRoomId, effectiveChallengeId],
      resourceKey: ["judging", "room-pace", activeRoomId],
      identityKey: me?.id ?? null,
    },
  );

  const progress = useLiveQuery<ChallengeProgress>(
    (signal) =>
      effectiveChallengeId
        ? getChallengeProgress(effectiveChallengeId, signal)
        : Promise.resolve(null as never),
    REALTIME_SCOPES.QUEUE,
    [EVENTS.QUEUE_ENTRY_CHANGED, EVENTS.QUEUE_ROOM_CHANGED],
    {
      enabled: canUse && effectiveChallengeId != null,
      queryKey: [effectiveChallengeId],
      resourceKey: ["judging", "challenge-progress", effectiveChallengeId],
      identityKey: me?.id ?? null,
    },
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
      if (err instanceof ApiError && err.status === 403) {
        setRooms([]);
        setChallenges([]);
      } else {
        const message = errorMessage(err, t, t("couldNotLoadQueueSetup"));
        setActionError(message);
        showQueueError(t, err, t("couldNotLoadQueueSetup"));
      }
    } finally {
      setRoomsLoading(false);
    }
  }, [canUse, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Fetching judging rooms is API sync.
    void loadRooms();
  }, [loadRooms]);

  const refreshLive = useCallback(async () => {
    if (activeRoomId) {
      invalidateServerState(["judging", "room-view", activeRoomId]);
      invalidateServerState(["judging", "room-pace", activeRoomId]);
    }
    if (effectiveChallengeId)
      invalidateServerState(["judging", "challenge-progress", effectiveChallengeId]);
    await Promise.all([roomView.refetch(), pace.refetch(), progress.refetch()]);
  }, [activeRoomId, effectiveChallengeId, roomView, pace, progress]);

  const mutate = useCallback(
    async (key: string, action: () => Promise<unknown>, success: string) => {
      setBusy(key);
      setActionError(null);
      try {
        await action();
        toast.success(success, { compactTitle: t("judging") });
        await refreshLive();
      } catch (err) {
        showQueueError(t, err, t("queueActionFailed"));
      } finally {
        setBusy(null);
      }
    },
    [refreshLive, t],
  );

  // Used by the queue panel's per-entry manual status changes.
  const handleManualCall = useCallback(
    (entry: QueueEntry, targetStatus: "called" | "in_room") =>
      activeRoomId &&
      mutate(
        `manual-${entry.id}`,
        () =>
          entryAction(entry.id, "manual-call", {
            targetStatus,
            roomId: activeRoomId,
            reason: "Manual queue selection",
          }),
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
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Clear search on empty query.
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
          showQueueError(t, err, t("searchFailed"));
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

  const reviewTarget = selectedReviewEntry ?? roomView.data?.active ?? null;
  const reviewTargetId = reviewTarget?.id ?? null;
  const reviewable =
    canJudge &&
    activeRoomId != null &&
    reviewTarget != null &&
    (reviewTarget.status === "in_room" ||
      reviewTarget.status === "presenting" ||
      selectedReviewEntry != null);

  const { windowOpen, moveReviewToWindow } = useReviewWindow(
    reviewable,
    reviewTargetId,
    activeRoomId,
    t,
  );

  // View project is a standing preference: the layout appears whenever a team
  // is in the room (or a past evaluation is open) and gives way to the queue when
  // nobody is, then comes back with the next team.
  const focusing = focusMode && canJudge && reviewTarget != null && !windowOpen;
  const lastReviewEntryRef = useRef<QueueEntry | null>(null);
  if (reviewTarget && !windowOpen) lastReviewEntryRef.current = reviewTarget;
  const formMounted = useExpandedTransition(focusing);

  if (!canUse) {
    return <AccessDenied ask={t("judgingAccessDeniedDesc")} />;
  }

  const view = roomView.data;
  const active = view?.active ?? null;
  const state = view?.state ?? null;
  const isPaused = state?.is_paused ?? view?.room.status === "paused";

  const reviewEntry = reviewTarget;
  const showForm = reviewEntry != null && !windowOpen;
  const closeReview = () => {
    if (confirmDiscardUnsavedChanges(reviewEditsAtRisk, t)) setSelectedReviewEntry(null);
  };
  const projectPanel = (
    <PresentationPanel
      entry={active}
      challenge={activeChallenge}
      waitingRoomCount={view?.called.length ?? 0}
      firstCalledEntry={view?.called[0] ?? null}
      canJudge={canJudge}
      canOperate={canOperate}
      busy={busy}
      preparationSeconds={pace.data?.configuredPreparationSeconds ?? null}
      presentationSeconds={pace.data?.configuredPresentationSeconds ?? null}
      detailsOpen={focusing}
      onExternalOpen={() => void moveReviewToWindow()}
      onEntryAction={(entry, action, body, label) =>
        mutate(`${action}-${entry.id}`, () => entryAction(entry.id, action, body), label)
      }
    />
  );
  const renderForm = (entry: QueueEntry) => (
    <ReviewForm
      key={entry.id}
      entry={entry}
      challenge={activeChallenge}
      panel={view?.challenge?.judging_panel_criteria ?? null}
      roomId={activeRoomId}
      canJudge={
        canJudge &&
        (active?.status === "in_room" ||
          active?.status === "presenting" ||
          selectedReviewEntry != null)
      }
      onClose={selectedReviewEntry ? closeReview : undefined}
      onUnsavedEditsAtRisk={setReviewEditsAtRisk}
    />
  );
  const formEntry = reviewEntry ?? lastReviewEntryRef.current;

  return (
    // App-like layout: the room selector pins to the top, the queue panel stays
    // put on the left, and only the right column (project + scoring) scrolls.
    // At xl we fill the shell from the floating sidebar's 8px top inset to the
    // viewport bottom so the outer page never scrolls. Keep the explicit height
    // from shrinking inside the flex parent; otherwise the main's bottom padding
    // leaves a gap below the panels. The negative margin bridges the main's 2rem
    // page padding to that top inset.
    <div
      className="flex min-h-0 flex-col gap-5 xl:-mt-6 xl:h-[calc(100svh-1rem)] xl:shrink-0 xl:overflow-hidden"
      data-wide
      data-judging-page
    >
      <JudgingTopBar
        rooms={rooms}
        activeRoomId={activeRoomId}
        roomsLoading={roomsLoading}
        onSelectRoom={(id) => {
          if (selectReviewEntry(null)) setRoomId(id);
        }}
        progress={progress.data}
        pace={pace.data}
        challengeId={effectiveChallengeId}
        onTimingSaved={() => void refreshLive()}
        canJudge={canJudge}
        canOperate={canOperate}
        canExport={canExport}
        focusMode={focusMode}
        onFocusModeChange={changeFocusMode}
        isPaused={isPaused}
        busy={busy}
        onPause={() =>
          activeRoomId && mutate("pause", () => pauseRoom(activeRoomId), t("roomPaused"))
        }
        onResume={() =>
          activeRoomId && mutate("pause", () => resumeRoom(activeRoomId), t("roomResumed"))
        }
      />

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
            className="button-interaction shrink-0 opacity-70 transition-opacity hover:opacity-100"
          >
            <XIcon aria-hidden="true" className="size-4" />
          </button>
        </div>
      )}

      {roomsLoading || roomView.loading ? (
        <div className="flex min-h-90 flex-1 items-center justify-center">
          <Spinner />
        </div>
      ) : !view ? (
        <div className="flex flex-1 items-center justify-center">
          <EmptyState
            icon={DoorOpenIcon}
            title={t("noRoomSelected")}
            description={t("noRoomSelectedDesc")}
          />
        </div>
      ) : (
        // Two-column region fills the remaining height. Left column is a fixed
        // container whose internal queue list scrolls; right column is the scroll area.
        <div
          className={cn(
            "grid min-h-0 gap-y-5 xl:h-0 xl:flex-1 xl:gap-y-0",
            "xl:grid-cols-[var(--queue-col)_minmax(0,1fr)_var(--form-col)]",
            "xl:transition-[grid-template-columns] xl:duration-500 xl:ease-in-out motion-reduce:transition-none",
          )}
          style={
            {
              "--queue-col": focusing ? "0px" : "380px",
              "--form-col": focusing ? "34rem" : "0px",
            } as React.CSSProperties
          }
        >
          <div
            className={cn(
              "min-w-0 xl:h-full xl:min-h-0 xl:overflow-hidden",
              focusing && "max-xl:hidden",
            )}
          >
            <div
              className={cn(
                "h-full xl:w-[360px] transition-opacity duration-300 motion-reduce:transition-none",
                focusing && "pointer-events-none opacity-0",
              )}
            >
              <QueuePanel
                view={view}
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
                  mutate(`${action}-${entry.id}`, () => entryAction(entry.id, action, body), label)
                }
                onMoveToPosition={(entry, position) =>
                  mutate(
                    `move-position-${entry.id}`,
                    () =>
                      moveQueueEntryToPosition(
                        entry.id,
                        position,
                        "Judging panel: moved team to position",
                      ),
                    t("queueTeamMoved"),
                  )
                }
                onAddTop={(entry) =>
                  mutate(
                    `move-top-${entry.id}`,
                    () =>
                      entryAction(entry.id, "move-top", {
                        reason: "Search: moved to top of queue",
                      }),
                    t("teamMovedTop"),
                  )
                }
                onAddWaiting={(entry) =>
                  activeRoomId &&
                  mutate(
                    `add-waiting-${entry.id}`,
                    () =>
                      entryAction(entry.id, "manual-call", {
                        targetStatus: "called",
                        roomId: activeRoomId,
                        reason: "Search: to waiting room",
                      }),
                    t("teamAddedWaiting"),
                  )
                }
                onReEnter={(entry, position) =>
                  mutate(
                    `re-enter-${entry.id}-${position}`,
                    () =>
                      entryAction(entry.id, "re-enter", {
                        position,
                        reason: "Recovered from manual search",
                      }),
                    t("teamReentered"),
                  )
                }
                onOpenReview={selectReviewEntry}
              />
            </div>
          </div>

          {/* Project column: the project panel and the evaluation form each scroll
              inside their own container, so every project detail is reachable and
              every judging question can be answered. */}
          <div className="min-w-0 xl:h-full xl:min-h-0">
            {focusMode || !showForm || !formEntry ? (
              <div className="h-full min-h-0">{projectPanel}</div>
            ) : (
              <div className="grid min-h-0 grid-cols-[minmax(0,1fr)] gap-5 xl:h-full xl:grid-rows-[auto_minmax(0,1fr)]">
                <div className="min-h-0 xl:max-h-[58vh]">{projectPanel}</div>
                <div className="min-h-96 xl:min-h-0">{renderForm(formEntry)}</div>
              </div>
            )}
          </div>

          {/* View project: the form slides in beside the project while a team is
              in the room and out again once nobody is. */}
          {focusMode && (
            <div className="min-w-0 xl:h-full xl:min-h-0 xl:overflow-hidden">
              {formMounted && formEntry && (
                <div
                  className={cn(
                    "transition-opacity duration-300 max-xl:mt-5 xl:h-full xl:w-[34rem] xl:pl-5 motion-reduce:transition-none",
                    focusing ? "opacity-100" : "opacity-0",
                  )}
                >
                  <div className="min-h-96 xl:h-full xl:min-h-0">{renderForm(formEntry)}</div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
