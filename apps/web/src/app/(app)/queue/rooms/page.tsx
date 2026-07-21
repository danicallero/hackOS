"use client";

// Queue admin surface for rooms and assignments (H46).

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS } from "@hackos/shared/events";
import { Building2Icon, LockIcon, PlusIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { type Column, DataTable } from "@/components/common/data-table";
import { EmptyState } from "@/components/common/empty-state";
import { Modal } from "@/components/common/modal";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
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
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import {
  assignRoomChallenge,
  assignRoomJudge,
  type ChallengeProgress,
  createRoom,
  deleteRoom,
  getChallengeProgress,
  getRoomAssignments,
  listRooms,
  type QueueSearchResult,
  type Room,
  type RoomAssignments,
  removeRoomJudge,
  searchTeams,
  updateRoom,
} from "@/lib/queue";
import { useSessionContext } from "@/lib/session";
import type { UserList } from "@/lib/types";
import { type Challenge, canAccessSponsorWorkspace, textForDisplay } from "../../challenges/shared";

type RoomEditor = {
  name: string;
  slug: string;
  location: string;
};

function emptyRoomEditor(): RoomEditor {
  return { name: "", slug: "", location: "" };
}

export default function QueueRoomsPage() {
  const { t } = useLocale();
  const { can, me } = useSessionContext();
  const canAdmin = can(CAPABILITIES.QUEUE_ADMIN);
  const canManageRooms = canAccessSponsorWorkspace(canAdmin, Boolean(me?.isSponsorRep));
  const [rooms, setRooms] = useState<Room[]>([]);
  const [assignments, setAssignments] = useState<Record<number, RoomAssignments | null>>({});
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [users, setUsers] = useState<UserList["users"]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRoomId, setSelectedRoomId] = useState<number | null>(null);
  const [modalMode, setModalMode] = useState<"create" | "edit" | null>(null);
  const [createDraft, setCreateDraft] = useState<RoomEditor>(emptyRoomEditor());
  const [roomDraft, setRoomDraft] = useState<RoomEditor>(emptyRoomEditor());
  const [saving, setSaving] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const selectedRoom = useMemo(
    () => rooms.find((room) => room.id === selectedRoomId) ?? null,
    [rooms, selectedRoomId],
  );
  const selectedRoomAssignments = selectedRoom ? (assignments[selectedRoom.id] ?? null) : null;

  const selectedChallengeFallback = challenges[0]?.id ?? 0;

  const load = useCallback(async () => {
    if (!canManageRooms) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [roomRows, challengeRows, userRows] = await Promise.all([
        listRooms(),
        api.get<{ challenges: Challenge[] }>(canAdmin ? "/api/challenges" : "/api/challenges/mine"),
        canAdmin
          ? api.get<UserList>("/api/users", { query: { limit: 200 } })
          : Promise.resolve({ users: [] }),
      ]);
      setRooms(roomRows);
      setChallenges(challengeRows.challenges);
      setUsers(userRows.users);
      setCreateDraft((draft) => (draft.name ? draft : { ...emptyRoomEditor() }));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotLoadRoomAdminData"));
    } finally {
      setLoading(false);
    }
  }, [canAdmin, canManageRooms, t]);

  const loadRoomDetails = useCallback(
    async (roomId: number) => {
      try {
        const [roomAssignments, judgeCandidates] = await Promise.all([
          getRoomAssignments(roomId),
          api.get<UserList>(`/api/queue/rooms/${roomId}/judge-candidates`).catch(() => ({
            users: [],
          })),
        ]);
        setAssignments((current) => ({ ...current, [roomId]: roomAssignments }));
        setUsers(judgeCandidates.users);
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : t("couldNotLoadRoomDetails"));
      }
    },
    [t],
  );

  const openCreateModal = () => {
    setSelectedRoomId(null);
    setCreateDraft(emptyRoomEditor());
    setModalMode("create");
  };

  const openManageModal = (roomId: number) => {
    setSelectedRoomId(roomId);
    setModalMode("edit");
  };

  const closeModal = () => {
    setModalMode(null);
    setSelectedRoomId(null);
  };

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selectedRoomId) return;
    void loadRoomDetails(selectedRoomId);
  }, [loadRoomDetails, selectedRoomId]);

  // Soft, in-place refresh instead of a hard reload when another admin
  // edits rooms/assignments elsewhere — but never while the room editor
  // modal is open, since `load` recomputing `selectedRoom` would reseed
  // `roomDraft` (name/slug/location) and discard an in-progress edit.
  const editingRef = useRef(false);
  editingRef.current = modalMode === "edit";
  const liveRefresh = useAutoRefresh("/api/queue/stream", [
    EVENTS.QUEUE_ENTRY_CHANGED,
    EVENTS.QUEUE_ROOM_CHANGED,
  ]);
  const isFirstLiveRefresh = useRef(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: liveRefresh is a ping-only nonce, intentionally added to retrigger this effect.
  useEffect(() => {
    if (isFirstLiveRefresh.current) {
      isFirstLiveRefresh.current = false;
      return;
    }
    if (editingRef.current) return;
    void load();
    if (selectedRoomId) void loadRoomDetails(selectedRoomId);
  }, [liveRefresh, load, loadRoomDetails, selectedRoomId]);

  useEffect(() => {
    if (!selectedRoom) return;
    setRoomDraft({
      name: selectedRoom.name,
      slug: selectedRoom.slug,
      location: selectedRoom.location ?? "",
    });
  }, [selectedRoom]);

  const roomStatusLabel = (status: string) =>
    status === "active"
      ? t("roomStatusActive")
      : status === "paused"
        ? t("roomStatusPaused")
        : status;

  const filteredRooms = useMemo(
    () => (statusFilter === "all" ? rooms : rooms.filter((room) => room.status === statusFilter)),
    [rooms, statusFilter],
  );
  const activeCount = useMemo(
    () => rooms.filter((room) => room.status === "active").length,
    [rooms],
  );

  const roomColumns: Column<Room>[] = [
    {
      id: "room",
      header: t("columnRoom"),
      sortValue: (room) => room.name.toLowerCase(),
      cell: (room) => (
        <div>
          <p className="font-medium">{room.name}</p>
          <p className="text-muted-foreground text-sm">{room.slug}</p>
        </div>
      ),
    },
    {
      id: "location",
      header: t("columnLocation"),
      sortValue: (room) => (room.location ?? "").toLowerCase(),
      cell: (room) =>
        room.location ? (
          <span>{room.location}</span>
        ) : (
          <span className="text-muted-foreground">{t("noLocationSet")}</span>
        ),
    },
    {
      id: "status",
      header: t("columnRoomStatus"),
      sortValue: (room) => room.status,
      cell: (room) => (
        <StatusBadge tone={room.status === "active" ? "success" : "warning"}>
          {roomStatusLabel(room.status)}
        </StatusBadge>
      ),
    },
  ];

  if (!canManageRooms) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("rooms")} />
        <EmptyState
          icon={LockIcon}
          title={t("noAccessRoomAdmin")}
          description={t("roomAdminDeniedDesc")}
        />
      </div>
    );
  }

  const saveCreate = async () => {
    if (!createDraft.name.trim() || !createDraft.slug.trim()) {
      toast.error(t("provideNameAndSlug"));
      return;
    }
    setSaving("create");
    try {
      await createRoom(
        {
          name: createDraft.name.trim(),
          slug: createDraft.slug.trim(),
          location: createDraft.location.trim() || null,
        },
        crypto.randomUUID(),
      );
      toast.success(t("roomCreated"));
      setCreateDraft(emptyRoomEditor());
      closeModal();
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotCreateRoom"));
    } finally {
      setSaving(null);
    }
  };

  const saveSelectedRoom = async () => {
    if (!selectedRoom) return;
    setSaving(`room-${selectedRoom.id}`);
    try {
      await updateRoom(selectedRoom.id, {
        name: roomDraft.name.trim(),
        slug: roomDraft.slug.trim(),
        location: roomDraft.location.trim() || null,
      });
      toast.success(t("roomUpdated"));
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotUpdateRoom"));
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("rooms")}
        actions={
          canAdmin && (
            <Button onClick={openCreateModal}>
              <PlusIcon className="size-4" />
              {t("createRoom")}
            </Button>
          )
        }
      />

      <SectionCard
        title={t("rooms")}
        description={
          !loading && rooms.length > 0
            ? t("roomsSummary", { active: activeCount, total: rooms.length })
            : undefined
        }
        icon={Building2Icon}
        bodyClassName="space-y-4"
      >
        {!loading && rooms.length === 0 ? (
          <EmptyState
            icon={Building2Icon}
            title={t("noRoomsConfigured")}
            description={t("noRoomsConfiguredDesc")}
          />
        ) : (
          <DataTable
            columns={roomColumns}
            data={filteredRooms}
            getRowId={(room) => String(room.id)}
            onRowClick={(room) => openManageModal(room.id)}
            getRowLabel={(room) => room.name}
            loading={loading}
            searchable={(room) => `${room.name} ${room.slug} ${room.location ?? ""}`}
            searchPlaceholder={t("filterRoomsPlaceholder")}
            searchLabel={t("filterRooms")}
            pageSize={10}
            toolbar={
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-9 w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("allRoomStatuses")}</SelectItem>
                  <SelectItem value="active">{t("roomStatusActive")}</SelectItem>
                  <SelectItem value="paused">{t("roomStatusPaused")}</SelectItem>
                </SelectContent>
              </Select>
            }
            filteredEmpty={{
              active: statusFilter !== "all",
              onClear: () => setStatusFilter("all"),
              title: t("noMatchingRooms"),
            }}
            empty={{
              icon: Building2Icon,
              title: t("noRoomsConfigured"),
              description: t("noRoomsConfiguredDesc"),
            }}
          />
        )}
      </SectionCard>

      <Modal
        open={modalMode !== null}
        onOpenChange={(open) => {
          if (!open) closeModal();
        }}
        title={modalMode === "create" ? t("createRoom") : (selectedRoom?.name ?? t("roomFallback"))}
        description={
          modalMode === "create" ? t("baseRoomDetails") : (selectedRoom?.slug ?? undefined)
        }
        size="xl"
        footer={
          modalMode === "create" ? (
            <>
              <Button variant="outline" onClick={closeModal}>
                {t("cancel")}
              </Button>
              <Button disabled={saving === "create"} onClick={() => void saveCreate()}>
                {t("createRoom")}
              </Button>
            </>
          ) : canAdmin ? (
            <div className="flex w-full flex-wrap items-center justify-between gap-2">
              <Button
                variant="destructive"
                disabled={saving === `room-${selectedRoom?.id}`}
                onClick={async () => {
                  if (!selectedRoom) return;
                  setSaving(`room-${selectedRoom.id}`);
                  try {
                    await deleteRoom(selectedRoom.id);
                    toast.success(t("roomDeleted"));
                    closeModal();
                    await load();
                  } catch (err) {
                    toast.error(err instanceof ApiError ? err.message : t("couldNotDeleteRoom"));
                  } finally {
                    setSaving(null);
                  }
                }}
              >
                {t("deleteRoom")}
              </Button>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={saving === `room-${selectedRoom?.id}`}
                  onClick={closeModal}
                >
                  {t("cancel")}
                </Button>
                <Button
                  disabled={saving === `room-${selectedRoom?.id}`}
                  onClick={() => void saveSelectedRoom()}
                >
                  {t("saveRoom")}
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="outline" onClick={closeModal}>
              {t("close")}
            </Button>
          )
        }
      >
        {modalMode === "create" && (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <Label>{t("name")}</Label>
              <Input
                value={createDraft.name}
                onChange={(e) => setCreateDraft((d) => ({ ...d, name: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("slugLabel")}</Label>
              <Input
                value={createDraft.slug}
                onChange={(e) => setCreateDraft((d) => ({ ...d, slug: e.target.value }))}
              />
            </div>
            <div className="space-y-2 lg:col-span-2">
              <Label>{t("locationLabel")}</Label>
              <Input
                value={createDraft.location}
                onChange={(e) => setCreateDraft((d) => ({ ...d, location: e.target.value }))}
              />
            </div>
          </div>
        )}
        {modalMode === "edit" && selectedRoom && (
          <div className="space-y-5">
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-2">
                <Label>{t("name")}</Label>
                <Input
                  value={roomDraft.name}
                  disabled={!canAdmin}
                  onChange={(e) =>
                    setRoomDraft((current) => ({ ...current, name: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>{t("slugLabel")}</Label>
                <Input
                  value={roomDraft.slug}
                  disabled={!canAdmin}
                  onChange={(e) =>
                    setRoomDraft((current) => ({ ...current, slug: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-2 lg:col-span-2">
                <Label>{t("locationLabel")}</Label>
                <Input
                  value={roomDraft.location}
                  disabled={!canAdmin}
                  onChange={(e) =>
                    setRoomDraft((current) => ({ ...current, location: e.target.value }))
                  }
                />
              </div>
            </div>
            <SectionCard title={t("assignments")}>
              <AssignmentsEditor
                roomId={selectedRoom.id}
                assignments={selectedRoomAssignments}
                challengeFallback={selectedChallengeFallback}
                challenges={challenges}
                users={users}
                onAddChallenge={async (challengeId) => {
                  if (!canAdmin) return;
                  await assignRoomChallenge(selectedRoom.id, challengeId);
                  await loadRoomDetails(selectedRoom.id);
                }}
                onAddJudge={async (challengeId, userId) => {
                  await assignRoomJudge(selectedRoom.id, challengeId, userId);
                  await loadRoomDetails(selectedRoom.id);
                }}
                onRemoveJudge={async (challengeId, userId) => {
                  await removeRoomJudge(selectedRoom.id, challengeId, userId);
                  await loadRoomDetails(selectedRoom.id);
                }}
                canSetChallenge={canAdmin}
              />
            </SectionCard>
            {selectedRoomAssignments?.challenges[0] && (
              <SectionCard title={t("challengeProgressTitle")}>
                <ChallengeResultsPanel
                  challengeId={selectedRoomAssignments.challenges[0].challenge_id}
                />
              </SectionCard>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

/**
 * Read-only progress + search for the room's assigned challenge (H46):
 * the sponsor-ownership fallback on `requireChallengeJudgeOrCapability`
 * lets a sponsor rep call these same endpoints the judging workspace uses,
 * without granting them any queue-operating capability.
 */
function ChallengeResultsPanel({ challengeId }: { challengeId: number }) {
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

function AssignmentsEditor({
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
          <Select value={userId} onValueChange={setUserId}>
            <SelectTrigger id={`judge-user-${roomId}`} className="w-full min-w-0 sm:flex-1">
              <SelectValue placeholder={t("selectJudgePlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {users.map((user) => (
                <SelectItem key={user.id} value={String(user.id)}>
                  {user.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
        <Label>{t("judgesCount", { count: judges.length })}</Label>
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
