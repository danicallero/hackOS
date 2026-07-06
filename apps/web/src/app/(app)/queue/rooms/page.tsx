"use client";

// Queue admin surface for rooms and assignments (H46).

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { ArrowLeftIcon, Building2Icon, LockIcon, PlusIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import { ApiError, api } from "@/lib/api";
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
import { type Challenge, textForDisplay } from "../../challenges/shared";

type RoomEditor = {
  name: string;
  slug: string;
  location: string;
};

function emptyRoomEditor(): RoomEditor {
  return { name: "", slug: "", location: "" };
}

export default function QueueRoomsPage() {
  const { can } = useSessionContext();
  const canAdmin = can(CAPABILITIES.QUEUE_ADMIN);
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
    if (!canAdmin) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [roomRows, challengeRows, userRows] = await Promise.all([
        listRooms(),
        api.get<{ challenges: Challenge[] }>("/api/challenges"),
        api.get<UserList>("/api/users", { query: { limit: 200 } }),
      ]);
      setRooms(roomRows);
      setChallenges(challengeRows.challenges);
      setUsers(userRows.users);
      setCreateDraft((draft) => (draft.name ? draft : { ...emptyRoomEditor() }));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not load room admin data.");
    } finally {
      setLoading(false);
    }
  }, [canAdmin]);

  const loadRoomDetails = useCallback(async (roomId: number) => {
    try {
      const roomAssignments = await getRoomAssignments(roomId);
      setAssignments((current) => ({ ...current, [roomId]: roomAssignments }));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not load room details.");
    }
  }, []);

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

  useEffect(() => {
    if (!selectedRoom) return;
    setRoomDraft({
      name: selectedRoom.name,
      slug: selectedRoom.slug,
      location: selectedRoom.location ?? "",
    });
  }, [selectedRoom]);

  if (!canAdmin) {
    return (
      <div className="space-y-6">
        <PageHeader title="Queue rooms" />
        <EmptyState
          icon={LockIcon}
          title="You can't access room admin"
          description="Room admin requires the queue:admin capability."
        />
      </div>
    );
  }

  const saveCreate = async () => {
    if (!createDraft.name.trim() || !createDraft.slug.trim()) {
      toast.error("Provide a name and slug.");
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
      toast.success("Room created.");
      setCreateDraft(emptyRoomEditor());
      closeModal();
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not create room.");
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
      toast.success("Room updated.");
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not update room.");
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Queue rooms"
        description="Rooms and assignment controls for the judging flow."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button onClick={openCreateModal}>
              <PlusIcon className="size-4" />
              Create room
            </Button>
            <Button variant="outline" asChild>
              <Link href="/queue">
                <ArrowLeftIcon className="size-4" />
                Back to panel
              </Link>
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <SectionCard
          title="Rooms"
          description="Create and manage judging rooms."
          icon={Building2Icon}
          bodyClassName="space-y-4"
        >
          {loading ? (
            <Spinner />
          ) : rooms.length === 0 ? (
            <EmptyState
              icon={Building2Icon}
              title="No rooms configured"
              description="Create the first judging room to start assigning challenges."
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
                      Manage
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
        title={modalMode === "create" ? "Create room" : (selectedRoom?.name ?? "Room")}
        description={
          modalMode === "create" ? "Base room details" : (selectedRoom?.slug ?? undefined)
        }
        size="xl"
        footer={
          <div className="flex flex-wrap gap-2">
            {modalMode === "create" ? (
              <Button disabled={saving === "create"} onClick={() => void saveCreate()}>
                Create room
              </Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  disabled={saving === `room-${selectedRoom?.id}`}
                  onClick={() => void load()}
                >
                  Reset
                </Button>
                <Button
                  disabled={saving === `room-${selectedRoom?.id}`}
                  onClick={() => void saveSelectedRoom()}
                >
                  Save room
                </Button>
              </>
            )}
          </div>
        }
      >
        {modalMode === "create" && (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                value={createDraft.name}
                onChange={(e) => setCreateDraft((d) => ({ ...d, name: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Slug</Label>
              <Input
                value={createDraft.slug}
                onChange={(e) => setCreateDraft((d) => ({ ...d, slug: e.target.value }))}
              />
            </div>
            <div className="space-y-2 lg:col-span-2">
              <Label>Location</Label>
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
                <Label>Name</Label>
                <Input
                  value={roomDraft.name}
                  onChange={(e) =>
                    setRoomDraft((current) => ({ ...current, name: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Slug</Label>
                <Input
                  value={roomDraft.slug}
                  onChange={(e) =>
                    setRoomDraft((current) => ({ ...current, slug: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-2 lg:col-span-2">
                <Label>Location</Label>
                <Input
                  value={roomDraft.location}
                  onChange={(e) =>
                    setRoomDraft((current) => ({ ...current, location: e.target.value }))
                  }
                />
              </div>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <SectionCard title="Assignments" description="Attach challenges and judges by id.">
                <AssignmentsEditor
                  roomId={selectedRoom.id}
                  assignments={selectedRoomAssignments}
                  challengeFallback={selectedChallengeFallback}
                  challenges={challenges}
                  users={users}
                  onAddChallenge={async (challengeId) => {
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
                />
              </SectionCard>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="destructive"
                disabled={saving === `room-${selectedRoom.id}`}
                onClick={async () => {
                  try {
                    await deleteRoom(selectedRoom.id);
                    toast.success("Room deleted.");
                    closeModal();
                    await load();
                  } catch (err) {
                    toast.error(err instanceof ApiError ? err.message : "Could not delete room.");
                  }
                }}
              >
                Delete room
              </Button>
            </div>
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
}: {
  roomId: number;
  assignments: RoomAssignments | null;
  challengeFallback: number;
  challenges: Challenge[];
  users: UserList["users"];
  onAddChallenge: (challengeId: number) => Promise<void>;
  onAddJudge: (challengeId: number, userId: number) => Promise<void>;
  onRemoveJudge: (challengeId: number, userId: number) => Promise<void>;
}) {
  const assignedChallenge = assignments?.challenges[0] ?? null;
  const [challengeId, setChallengeId] = useState("");
  const effectiveChallengeId = assignedChallenge?.challenge_id ?? Number(challengeId || 0);
  const [userId, setUserId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const nextChallengeId = assignments?.challenges[0]?.challenge_id ?? challengeFallback;
    setChallengeId(nextChallengeId ? String(nextChallengeId) : "");
  }, [assignments?.challenges, challengeFallback]);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2 rounded-md border p-3">
          <p className="text-sm font-medium">Room challenge</p>
          {assignedChallenge ? (
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{assignedChallenge.title}</p>
                <p className="text-muted-foreground text-xs">
                  {assignedChallenge.assigned_by_email ?? "system"}
                </p>
              </div>
              <StatusBadge tone="brand">id {assignedChallenge.challenge_id}</StatusBadge>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">No challenge assigned.</p>
          )}
        </div>

        <div className="space-y-2 rounded-md border p-3">
          <p className="text-sm font-medium">Current judges</p>
          {assignments?.judges?.length ? (
            <ul className="space-y-2">
              {assignments.judges.map((assignment) => (
                <li
                  key={`${assignment.challenge_id}:${assignment.user_id}`}
                  className="flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {assignment.name ?? assignment.email}
                    </p>
                    <p className="text-muted-foreground text-xs">{assignment.title}</p>
                  </div>
                  <StatusBadge tone="info">user {assignment.user_id}</StatusBadge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm">No judges assigned.</p>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`challenge-${roomId}`}>Room challenge</Label>
        <div className="flex gap-2">
          <Select value={challengeId || undefined} onValueChange={setChallengeId}>
            <SelectTrigger id={`challenge-${roomId}`} className="flex-1">
              <SelectValue placeholder="Challenge" />
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
            disabled={busy === "challenge" || !challengeId}
            onClick={async () => {
              setBusy("challenge");
              try {
                await onAddChallenge(Number(challengeId));
                toast.success("Challenge assigned.");
              } catch (err) {
                toast.error(err instanceof ApiError ? err.message : "Could not assign challenge.");
              } finally {
                setBusy(null);
              }
            }}
          >
            Set
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`judge-user-${roomId}`}>Assign judge</Label>
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <Select value={userId} onValueChange={setUserId}>
            <SelectTrigger id={`judge-user-${roomId}`}>
              <SelectValue placeholder="User" />
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
            disabled={busy === "judge" || !userId || !effectiveChallengeId}
            onClick={async () => {
              setBusy("judge");
              try {
                await onAddJudge(effectiveChallengeId, Number(userId));
                toast.success("Judge assigned.");
              } catch (err) {
                toast.error(err instanceof ApiError ? err.message : "Could not assign judge.");
              } finally {
                setBusy(null);
              }
            }}
          >
            Add
          </Button>
        </div>
      </div>

      {assignments?.judges?.length ? (
        <div className="space-y-2 rounded-md border p-3">
          <p className="text-sm font-medium">Remove judges</p>
          <div className="space-y-2">
            {assignments.judges.map((assignment) => (
              <div
                key={`${assignment.challenge_id}:${assignment.user_id}`}
                className="flex items-center justify-between gap-3"
              >
                <p className="min-w-0 truncate text-sm">{assignment.email}</p>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy === `remove-judge-${assignment.user_id}`}
                  onClick={async () => {
                    setBusy(`remove-judge-${assignment.user_id}`);
                    try {
                      await onRemoveJudge(assignment.challenge_id, assignment.user_id);
                      toast.success("Judge removed.");
                    } catch (err) {
                      toast.error(
                        err instanceof ApiError ? err.message : "Could not remove judge.",
                      );
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
