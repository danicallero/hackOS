"use client";

// Queue admin surface for rooms and assignments (H46).

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS } from "@hackos/shared/events";
import { Building2Icon, LockIcon, PlusIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
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
  createRoom,
  deleteRoom,
  getRoomAssignments,
  listRooms,
  type Room,
  type RoomAssignments,
  removeRoomJudge,
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

  if (!canManageRooms) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("queueRooms")} />
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
        title={t("queueRooms")}
        actions={
          canAdmin && (
            <Button onClick={openCreateModal}>
              <PlusIcon className="size-4" />
              {t("createRoom")}
            </Button>
          )
        }
      />

      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <SectionCard title={t("rooms")} icon={Building2Icon} bodyClassName="space-y-4">
          {loading ? (
            <Spinner />
          ) : rooms.length === 0 ? (
            <EmptyState
              icon={Building2Icon}
              title={t("noRoomsConfigured")}
              description={t("noRoomsConfiguredDesc")}
            />
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {rooms.map((room) => (
                <div key={room.id} className="rounded-md border p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">{room.name}</p>
                      <p className="text-muted-foreground text-sm">
                        {room.slug}
                        {room.location ? ` · ${room.location}` : ""}
                      </p>
                    </div>
                    <StatusBadge tone={room.status === "active" ? "success" : "warning"}>
                      {room.status}
                    </StatusBadge>
                  </div>
                  <div className="mt-4 flex justify-end">
                    <Button variant="outline" size="sm" onClick={() => openManageModal(room.id)}>
                      {t("manage")}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

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
          </div>
        )}
      </Modal>
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
